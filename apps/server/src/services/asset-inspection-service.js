const DEFAULT_SAMPLE_BYTES = 65_536;

async function responseBytes(body) {
  if (body instanceof Uint8Array) return body;
  if (typeof body?.transformToByteArray === "function") {
    return new Uint8Array(await body.transformToByteArray());
  }
  if (typeof body?.arrayBuffer === "function") return new Uint8Array(await body.arrayBuffer());
  throw new Error("Object Storage response has no readable body");
}

export function createAssetInspectionService({
  repository,
  objectStore,
  inspector,
  instanceId,
  now = () => new Date(),
  batchSize = 10,
  leaseSeconds = 60,
  retrySeconds = 300,
  maxAttempts = 3,
  sampleBytes = DEFAULT_SAMPLE_BYTES
}) {
  if (!repository?.claim || !repository?.complete || !repository?.fail) {
    throw new Error("Asset inspection repository is required");
  }
  if (!objectStore?.getRange) throw new Error("Ranged Object Storage read is required");
  if (typeof inspector?.inspect !== "function") throw new Error("Media inspector is required");
  if (typeof instanceId !== "string" || instanceId.length < 1) throw new Error("Inspection instance ID is required");

  return Object.freeze({
    async runOnce() {
      const started = now();
      const candidates = await repository.claim({
        instanceId,
        now: started.toISOString(),
        leaseExpiresAt: new Date(started.getTime() + leaseSeconds * 1000).toISOString(),
        limit: batchSize,
        maxAttempts
      });
      const summary = { claimed: candidates.length, accepted: 0, rejected: 0, retried: 0, errors: 0, leaseLost: 0 };
      for (const candidate of candidates) {
        try {
          const expectedBytes = Math.min(candidate.byteSize, sampleBytes);
          const bytes = expectedBytes === 0
            ? new Uint8Array()
            : await responseBytes((await objectStore.getRange(
                candidate.storageKey, 0, expectedBytes - 1
              )).Body);
          if (bytes.byteLength !== expectedBytes) throw new Error("Inspection sample length mismatch");
          const result = inspector.inspect({
            declaredMediaType: candidate.declaredMediaType,
            bytes,
            complete: candidate.byteSize <= sampleBytes
          });
          if (!new Set(["accepted", "rejected"]).has(result.decision)) {
            throw new Error("Inspector returned an invalid decision");
          }
          const completed = await repository.complete({
            id: candidate.id,
            workspaceId: candidate.workspaceId,
            instanceId,
            decision: result.decision,
            detectedMediaType: result.detectedMediaType,
            policyVersion: result.policyVersion,
            inspectedAt: now().toISOString()
          });
          if (completed) summary[result.decision] += 1;
          else summary.leaseLost += 1;
        } catch {
          const failedAt = now();
          const status = await repository.fail({
            id: candidate.id,
            workspaceId: candidate.workspaceId,
            instanceId,
            failedAt: failedAt.toISOString(),
            retryAt: new Date(failedAt.getTime() + retrySeconds * 1000).toISOString(),
            maxAttempts
          });
          if (status === "pending") summary.retried += 1;
          else if (status === "error") summary.errors += 1;
          else summary.leaseLost += 1;
        }
      }
      return summary;
    }
  });
}
