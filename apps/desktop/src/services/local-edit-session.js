export class LocalEditSessionError extends Error {
  constructor(code, message = code, options) {
    super(message, options);
    this.name = "LocalEditSessionError";
    this.code = code;
  }
}

function assertRevision(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new LocalEditSessionError("invalid_local_revision");
  }
  return value;
}

export function createLocalEditSession({ documentId, localRevision = 0 }) {
  if (typeof documentId !== "string" || documentId.length === 0) {
    throw new LocalEditSessionError("invalid_local_document_id");
  }

  let revision = assertRevision(localRevision);
  let queue = Promise.resolve();
  let blockedError = null;

  const session = {
    documentId,
    get revision() { return revision; },
    get blocked() { return blockedError !== null; },
    get error() { return blockedError; },
    block(error) {
      blockedError = error instanceof Error
        ? error
        : new LocalEditSessionError("local_persistence_blocked");
    },
    enqueue(save, { retry = false } = {}) {
      if (typeof save !== "function") throw new LocalEditSessionError("invalid_local_save");

      const operation = queue.then(async () => {
        if (blockedError && !retry) {
          throw new LocalEditSessionError("local_persistence_blocked", undefined, {
            cause: blockedError
          });
        }
        if (retry) blockedError = null;

        try {
          const nextRevision = assertRevision(revision + 1);
          const result = await save(nextRevision);
          revision = nextRevision;
          blockedError = null;
          return { revision, result };
        } catch (error) {
          blockedError = error;
          throw error;
        }
      });

      queue = operation.catch(() => undefined);
      return operation;
    },
    async waitForIdle() {
      await queue;
    }
  };

  return Object.freeze(session);
}

export async function prepareLocalEditTransition({
  isComposing,
  cancelScheduledSave,
  save,
  isCurrent = () => true
}) {
  if (isComposing) return Object.freeze({ ok: false, reason: "composition_active" });
  if (typeof cancelScheduledSave !== "function" || typeof save !== "function"
    || typeof isCurrent !== "function") {
    throw new LocalEditSessionError("invalid_local_transition");
  }
  cancelScheduledSave();
  const checkpoint = await save();
  if (!isCurrent()) return Object.freeze({ ok: false, reason: "edit_changed" });
  return checkpoint?.durable === true
    ? Object.freeze({ ok: true, checkpoint })
    : Object.freeze({ ok: false, reason: "durable_save_required" });
}
