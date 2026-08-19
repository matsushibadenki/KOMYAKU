import { v7 as uuidv7 } from "uuid";
import { z } from "zod";

export const DEFAULT_MAX_ASSET_BYTES = 100 * 1024 * 1024;

const tokenSchema = z.string().regex(/^[a-z][a-z0-9._-]{0,99}$/);
const storeRequestSchema = z.object({
  workspaceId: z.string().uuid(),
  actorId: z.string().uuid(),
  mediaType: z.string().min(1).max(200),
  body: z.union([z.string(), z.instanceof(Uint8Array)]),
  reference: z.object({
    referrerType: tokenSchema,
    referrerId: z.string().uuid(),
    relation: tokenSchema
  }).strict()
}).strict();

const releaseRequestSchema = z.object({
  workspaceId: z.string().uuid(),
  actorId: z.string().uuid(),
  referenceId: z.string().uuid()
}).strict();

function byteLength(body) {
  return typeof body === "string" ? new TextEncoder().encode(body).byteLength : body.byteLength;
}

export function createAssetService({
  objectStore,
  repository,
  authorizeAsset,
  maxAssetBytes = DEFAULT_MAX_ASSET_BYTES,
  idFactory = uuidv7
}) {
  if (!objectStore?.putContentAddressed) throw new Error("Content-addressed object store is required");
  if (!repository?.claimContentAddressedAsset || !repository?.releaseAssetReference) {
    throw new Error("Asset repository is required");
  }
  if (typeof authorizeAsset !== "function") throw new Error("Asset authorization policy is required");
  if (!Number.isSafeInteger(maxAssetBytes) || maxAssetBytes <= 0) {
    throw new Error("Asset byte limit must be a positive integer");
  }

  return Object.freeze({
    async storeAndReference(requestInput) {
      const request = storeRequestSchema.parse(requestInput);
      const authorized = await authorizeAsset({
        workspaceId: request.workspaceId,
        actorId: request.actorId,
        action: "asset:write"
      });
      if (authorized !== true) throw new Error("Asset write is not authorized");

      const size = byteLength(request.body);
      if (size > maxAssetBytes) throw new Error(`Asset exceeds the ${maxAssetBytes} byte limit`);
      const stored = await objectStore.putContentAddressed({
        workspaceId: request.workspaceId,
        body: request.body,
        contentType: request.mediaType,
        metadata: { "workspace-id": request.workspaceId }
      });
      if (stored.byteSize !== size) throw new Error("Stored Asset size did not match the source payload");

      const claimed = await repository.claimContentAddressedAsset({
        candidate: {
          id: idFactory(),
          workspaceId: request.workspaceId,
          mediaType: request.mediaType,
          byteSize: stored.byteSize,
          contentHash: stored.contentHash,
          storageKey: stored.key,
          createdBy: request.actorId
        },
        reference: { id: idFactory(), ...request.reference }
      });
      return { ...claimed, objectCreated: stored.created };
    },

    async releaseReference(requestInput) {
      const request = releaseRequestSchema.parse(requestInput);
      const authorized = await authorizeAsset({
        workspaceId: request.workspaceId,
        actorId: request.actorId,
        action: "asset:unlink"
      });
      if (authorized !== true) throw new Error("Asset reference release is not authorized");
      return repository.releaseAssetReference({
        workspaceId: request.workspaceId,
        referenceId: request.referenceId
      });
    }
  });
}
