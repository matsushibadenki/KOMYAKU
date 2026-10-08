// A checkpoint from the previous editor can survive a batched transition render.
// Never mark a new session loaded until its own durable checkpoint is available.
export function shouldLoadSessionHistory({ checkpoint, session, loadedSession, mode }) {
  return mode === 'local' && Boolean(checkpoint?.durable && session
    && checkpoint.document?.id === session.documentId && loadedSession !== session);
}
