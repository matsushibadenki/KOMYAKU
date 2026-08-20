import { v7 as uuidv7 } from "uuid";
import { z } from "zod";

const operatorSchema = z.object({
  operatorId: z.string().trim().min(1).max(200),
  reason: z.string().trim().min(1).max(1000)
});
const workspaceSchema = z.string().uuid();
const policySchema = z.object({
  inactiveDays: z.number().int().min(1).max(365).default(1),
  quarantineDays: z.number().int().min(7).max(3650).default(30),
  retryMinutes: z.number().int().min(5).max(1440).default(60),
  batchSize: z.number().int().min(1).max(1000).default(100)
});

function plus(date, milliseconds) {
  return new Date(date.getTime() + milliseconds).toISOString();
}

function minus(date, milliseconds) {
  return new Date(date.getTime() - milliseconds).toISOString();
}

function assetPrefix(workspaceId) {
  return `workspaces/${workspaceId}/assets/`;
}

function parseContentAddressedKey(workspaceId, key) {
  const prefix = `${assetPrefix(workspaceId)}sha256/`;
  if (!key.startsWith(prefix)) return null;
  const suffix = key.slice(prefix.length);
  const match = /^([a-f0-9]{2})\/([a-f0-9]{64})$/.exec(suffix);
  if (!match || match[1] !== match[2].slice(0, 2)) return null;
  return match[2];
}

export function createAssetLifecycleService({
  repository,
  objectStore,
  now = () => new Date(),
  idFactory = uuidv7
}) {
  const requiredRepositoryMethods = [
    "listKnownStorageKeys", "reconcileOrphanObjects", "quarantineReferenceZero",
    "claimDueAssetPurges", "completeAssetPurge", "retryAssetPurge",
    "claimDueOrphanPurges", "completeOrphanPurge", "retryOrphanPurge", "audit"
  ];
  if (requiredRepositoryMethods.some((method) => typeof repository?.[method] !== "function")) {
    throw new Error("Asset lifecycle repository is required");
  }
  if (!objectStore?.listPrefix || !objectStore?.delete) {
    throw new Error("Asset lifecycle Object Storage adapter is required");
  }

  function operation(input) {
    return { ...operatorSchema.parse(input), operationId: idFactory() };
  }

  return Object.freeze({
    async reconcileWorkspace({
      workspaceId: workspaceInput,
      continuationToken,
      quarantineDays: quarantineDaysInput = 30,
      ...operatorInput
    }) {
      const workspaceId = workspaceSchema.parse(workspaceInput);
      const quarantineDays = z.number().int().min(7).max(3650).parse(quarantineDaysInput);
      const operator = operation(operatorInput);
      const observed = now();
      const page = await objectStore.listPrefix({
        prefix: assetPrefix(workspaceId), continuationToken, maxKeys: 100
      });
      const canonicalObjects = [];
      let unexpectedKeys = 0;
      for (const object of page.objects) {
        const contentHash = parseContentAddressedKey(workspaceId, object.key);
        if (contentHash) canonicalObjects.push({ ...object, contentHash });
        else unexpectedKeys += 1;
      }
      const known = new Set(await repository.listKnownStorageKeys({
        workspaceId, storageKeys: canonicalObjects.map((object) => object.key)
      }));
      const knownOnPage = [];
      const orphans = [];
      for (const object of canonicalObjects) {
        if (known.has(object.key)) {
          knownOnPage.push(object.key);
        } else {
          orphans.push({
            id: idFactory(), storageKey: object.key,
            contentHash: object.contentHash, byteSize: object.byteSize
          });
        }
      }
      await repository.reconcileOrphanObjects({
        workspaceId,
        orphans,
        knownStorageKeys: knownOnPage,
        observedAt: observed.toISOString(),
        purgeAfter: plus(observed, quarantineDays * 86_400_000)
      });
      const result = {
        workspaceId,
        quarantineDays,
        scanned: page.objects.length,
        known: knownOnPage.length,
        quarantinedOrphans: orphans.length,
        unexpectedKeys,
        nextContinuationToken: page.nextContinuationToken ?? null
      };
      await repository.audit({
        ...operator, action: "asset.reconcile", reason: operator.reason, metadata: result
      });
      return result;
    },

    async quarantineReferenceZero({ policy: policyInput, ...operatorInput }) {
      const operator = operation(operatorInput);
      const policy = policySchema.parse(policyInput ?? {});
      const current = now();
      const candidates = await repository.quarantineReferenceZero({
        inactiveBefore: minus(current, policy.inactiveDays * 86_400_000),
        quarantinedAt: current.toISOString(),
        purgeAfter: plus(current, policy.quarantineDays * 86_400_000),
        limit: policy.batchSize
      });
      const result = { quarantined: candidates.length, policy };
      await repository.audit({
        ...operator, action: "asset.quarantine_reference_zero", reason: operator.reason, metadata: result
      });
      return result;
    },

    async purgeDue({ policy: policyInput, ...operatorInput }) {
      const operator = operation(operatorInput);
      const policy = policySchema.parse(policyInput ?? {});
      const current = now();
      const claimInput = { now: current.toISOString(), limit: policy.batchSize };
      const candidates = [
        ...(await repository.claimDueAssetPurges(claimInput)).map((candidate) => ({ ...candidate, kind: "asset" })),
        ...(await repository.claimDueOrphanPurges(claimInput)).map((candidate) => ({ ...candidate, kind: "orphan" }))
      ];
      const result = { claimed: candidates.length, purged: 0, retried: 0 };
      for (const candidate of candidates) {
        const contentHash = parseContentAddressedKey(candidate.workspaceId, candidate.storageKey);
        const repositoryPrefix = candidate.kind === "asset" ? "Asset" : "Orphan";
        if (!contentHash || contentHash !== candidate.contentHash) {
          await repository[`retry${repositoryPrefix}Purge`]({
            id: candidate.id,
            workspaceId: candidate.workspaceId,
            failedAt: current.toISOString(),
            retryAt: plus(current, policy.retryMinutes * 60_000)
          });
          result.retried += 1;
          continue;
        }
        try {
          await objectStore.delete(candidate.storageKey);
          const completed = await repository[`complete${repositoryPrefix}Purge`]({
            id: candidate.id, workspaceId: candidate.workspaceId, purgedAt: now().toISOString()
          });
          if (!completed) throw new Error("Asset purge state changed before completion");
          result.purged += 1;
        } catch {
          await repository[`retry${repositoryPrefix}Purge`]({
            id: candidate.id,
            workspaceId: candidate.workspaceId,
            failedAt: now().toISOString(),
            retryAt: plus(now(), policy.retryMinutes * 60_000)
          });
          result.retried += 1;
        }
      }
      await repository.audit({
        ...operator, action: "asset.purge", reason: operator.reason, metadata: { ...result, policy }
      });
      return result;
    }
  });
}
