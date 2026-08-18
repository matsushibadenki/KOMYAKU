import { loadRuntimeConfig } from "../src/config.js";
import { createDatabase } from "../src/database/client.js";
import { createDeadLetterRepository } from "../src/repositories/dead-letter-repository.js";
import { createDeadLetterService } from "../src/services/dead-letter-service.js";

function option(name) {
  const index = Bun.argv.indexOf(name);
  return index >= 0 ? Bun.argv[index + 1] : null;
}

const command = Bun.argv[2];
const config = loadRuntimeConfig();
const database = createDatabase(config);
const service = createDeadLetterService(createDeadLetterRepository(database.sql));
try {
  if (command === "list") {
    const result = await service.list({
      limit: option("--limit") ? Number(option("--limit")) : 50,
      cursor: option("--cursor")
    });
    console.log(JSON.stringify(result, null, 2));
  } else if (command === "retry") {
    const operatorId = Bun.env.OPERATOR_ID;
    if (!operatorId) throw new Error("OPERATOR_ID is required for retry");
    const result = await service.retry({
      jobId: Bun.argv[3],
      operatorId,
      reason: option("--reason"),
      additionalAttempts: option("--additional-attempts")
        ? Number(option("--additional-attempts")) : 3
    });
    console.log(JSON.stringify(result, null, 2));
  } else {
    throw new Error("Usage: jobs:dead-letters <list|retry JOB_ID> [options]");
  }
} finally {
  await database.close();
}
