import { z } from "zod";
import { JobExecutionError } from "./job-runner.js";

const payloadSchema = z.object({ importId: z.string().uuid() });

export function createConversationArchiveVerificationHandler({ repository, objectStore }) {
  if (!repository?.findImportArchive) throw new Error("Conversation archive repository is required");
  if (!objectStore?.head) throw new Error("Object store is required");

  return async function verifyConversationArchive(job) {
    const parsed = payloadSchema.safeParse(job.payload);
    if (!parsed.success) throw new JobExecutionError("invalid_job_payload", { retryable: false });
    const archive = await repository.findImportArchive(parsed.data.importId);
    if (!archive) throw new JobExecutionError("archive_record_missing", { retryable: false });

    let head;
    try {
      head = await objectStore.head(archive.storageKey);
    } catch {
      throw new JobExecutionError("archive_object_unavailable");
    }
    if (Number(head.ContentLength) !== archive.byteSize) {
      throw new JobExecutionError("archive_size_mismatch", { retryable: false });
    }
    const storedHash = head.Metadata?.["content-sha256"];
    if (storedHash !== archive.contentHash) {
      throw new JobExecutionError("archive_hash_mismatch", { retryable: false });
    }
  };
}
