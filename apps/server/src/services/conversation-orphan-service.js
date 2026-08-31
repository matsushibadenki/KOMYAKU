import { v7 as uuidv7 } from "uuid";
import { z } from "zod";

const operatorSchema = z.object({
  operatorId: z.string().trim().min(1).max(200),
  reason: z.string().trim().min(1).max(1000)
});

export function createConversationOrphanService({ repository, objectStore, now = () => new Date(), idFactory = uuidv7 }) {
  if (!repository?.listKnownStorageKeys || !repository?.reconcile) throw new Error("Conversation orphan repository is required");
  if (!objectStore?.listPrefix) throw new Error("Conversation orphan Object Storage adapter is required");
  return Object.freeze({
    async reconcileWorkspace({ workspaceId: workspaceInput, continuationToken, ...operatorInput }) {
      const workspaceId = z.string().uuid().parse(workspaceInput);
      const operator = operatorSchema.parse(operatorInput);
      const prefix = `workspaces/${workspaceId}/conversation-imports/`;
      const page = await objectStore.listPrefix({ prefix, continuationToken, maxKeys: 100 });
      const canonical = [];
      let unexpectedKeys = 0;
      for (const object of page.objects) {
        const suffix = object.key.slice(prefix.length);
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/source\.bin$/.test(suffix)) {
          canonical.push(object);
        } else unexpectedKeys += 1;
      }
      const known = new Set(await repository.listKnownStorageKeys({
        workspaceId, storageKeys: canonical.map((object) => object.key)
      }));
      const orphans = canonical.filter((object) => !known.has(object.key)).map((object) => ({
        id: idFactory(), storageKey: object.key, byteSize: object.byteSize
      }));
      const summary = {
        workspaceId, scanned: page.objects.length, known: canonical.length - orphans.length,
        quarantinedOrphans: orphans.length, unexpectedKeys,
        nextContinuationToken: page.nextContinuationToken ?? null
      };
      await repository.reconcile({
        workspaceId, orphans, knownStorageKeys: canonical.filter((object) => known.has(object.key)).map((object) => object.key),
        observedAt: now().toISOString(), ...operator, summary
      });
      return summary;
    }
  });
}
