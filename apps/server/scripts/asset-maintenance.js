import { createObjectStore, createS3Client } from "@komyaku/storage-core";
import { loadRuntimeConfig } from "../src/config.js";
import { createDatabase } from "../src/database/client.js";
import { createAssetLifecycleRepository } from "../src/repositories/asset-lifecycle-repository.js";
import { createAssetInspectionRepository } from "../src/repositories/asset-inspection-repository.js";
import { createAssetLifecycleService } from "../src/services/asset-lifecycle-service.js";
import { createAssetInspectionService } from "../src/services/asset-inspection-service.js";
import { createBaselineMediaInspector } from "../src/services/baseline-media-inspector.js";

function argument(name) {
  const index = Bun.argv.indexOf(name);
  return index >= 0 ? Bun.argv[index + 1] : undefined;
}

const action = argument("--action");
if (!new Set(["inspect", "reconcile", "quarantine", "purge"]).has(action)) {
  throw new Error("Use --action inspect|reconcile|quarantine|purge");
}

const config = loadRuntimeConfig();
const database = createDatabase(config);
const client = createS3Client(config.objectStorage);
const objectStore = createObjectStore({ client, bucket: config.objectStorage.bucket });
const service = createAssetLifecycleService({
  repository: createAssetLifecycleRepository(database.sql), objectStore
});
const operator = {
  operatorId: Bun.env.OPERATOR_ID,
  reason: Bun.env.ASSET_MAINTENANCE_REASON
};
const policy = {
  inactiveDays: Number(Bun.env.ASSET_INACTIVE_DAYS || 1),
  quarantineDays: Number(Bun.env.ASSET_QUARANTINE_DAYS || 30),
  retryMinutes: Number(Bun.env.ASSET_PURGE_RETRY_MINUTES || 60),
  batchSize: Number(Bun.env.ASSET_MAINTENANCE_BATCH_SIZE || 100)
};

try {
  let result;
  if (action === "reconcile") {
    const workspaceId = argument("--workspace");
    const pages = [];
    let continuationToken;
    do {
      const page = await service.reconcileWorkspace({
        workspaceId, continuationToken, quarantineDays: policy.quarantineDays, ...operator
      });
      pages.push(page);
      continuationToken = page.nextContinuationToken ?? undefined;
    } while (continuationToken);
    result = {
      pages: pages.length,
      scanned: pages.reduce((sum, page) => sum + page.scanned, 0),
      known: pages.reduce((sum, page) => sum + page.known, 0),
      quarantinedOrphans: pages.reduce((sum, page) => sum + page.quarantinedOrphans, 0),
      unexpectedKeys: pages.reduce((sum, page) => sum + page.unexpectedKeys, 0)
    };
  } else if (action === "inspect") {
    result = await createAssetInspectionService({
      repository: createAssetInspectionRepository(database.sql),
      objectStore,
      inspector: createBaselineMediaInspector(),
      instanceId: config.instanceId,
      batchSize: policy.batchSize
    }).runOnce();
  } else if (action === "quarantine") {
    result = await service.quarantineReferenceZero({ ...operator, policy });
  } else {
    result = await service.purgeDue({ ...operator, policy });
  }
  console.log(JSON.stringify({ action, result }, null, 2));
} finally {
  client.destroy();
  await database.close();
}
