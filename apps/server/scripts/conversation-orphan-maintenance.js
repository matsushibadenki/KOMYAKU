import { createObjectStore, createS3Client } from "@komyaku/storage-core";
import { loadRuntimeConfig } from "../src/config.js";
import { createDatabase } from "../src/database/client.js";
import { createConversationOrphanRepository } from "../src/repositories/conversation-orphan-repository.js";
import { createConversationOrphanService } from "../src/services/conversation-orphan-service.js";

const workspaceIndex = Bun.argv.indexOf("--workspace");
const workspaceId = workspaceIndex >= 0 ? Bun.argv[workspaceIndex + 1] : undefined;
const config = loadRuntimeConfig();
const database = createDatabase(config);
const client = createS3Client(config.objectStorage);
const service = createConversationOrphanService({
  repository: createConversationOrphanRepository(database.sql),
  objectStore: createObjectStore({ client, bucket: config.objectStorage.bucket })
});
try {
  const pages = [];
  let continuationToken;
  do {
    const page = await service.reconcileWorkspace({
      workspaceId, continuationToken,
      operatorId: Bun.env.OPERATOR_ID,
      reason: Bun.env.CONVERSATION_ORPHAN_REASON
    });
    pages.push(page);
    continuationToken = page.nextContinuationToken ?? undefined;
  } while (continuationToken);
  console.log(JSON.stringify({
    pages: pages.length,
    scanned: pages.reduce((sum, page) => sum + page.scanned, 0),
    known: pages.reduce((sum, page) => sum + page.known, 0),
    quarantinedOrphans: pages.reduce((sum, page) => sum + page.quarantinedOrphans, 0),
    unexpectedKeys: pages.reduce((sum, page) => sum + page.unexpectedKeys, 0)
  }, null, 2));
} finally {
  client.destroy();
  await database.close();
}
