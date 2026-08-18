function retryDelaySeconds(attemptCount) {
  return Math.min(300, 2 ** Math.min(Math.max(attemptCount - 1, 0), 8));
}

export function createOutboxDispatcher({
  repository,
  instanceId,
  batchSize = 25,
  leaseSeconds = 30,
  pollIntervalMs = 1_000,
  maxAttempts = 10,
  log = console.info
}) {
  if (!repository?.claimBatch || !repository?.publishAsJob || !repository?.releaseForRetry) {
    throw new Error("Outbox repository is required");
  }
  if (!instanceId) throw new Error("Outbox dispatcher instance ID is required");

  let stopped = true;
  let timer = null;
  let activeRun = null;

  async function runOnce() {
    const events = await repository.claimBatch({ leaseOwner: instanceId, leaseSeconds, batchSize });
    let published = 0;
    let failed = 0;
    for (const event of events) {
      try {
        await repository.publishAsJob({ event, leaseOwner: instanceId });
        published += 1;
      } catch (error) {
        const permanentlyFailed = event.attemptCount >= maxAttempts;
        await repository.releaseForRetry({
          eventId: event.id,
          leaseOwner: instanceId,
          delaySeconds: permanentlyFailed ? 0 : retryDelaySeconds(event.attemptCount),
          failed: permanentlyFailed
        });
        failed += 1;
        log(JSON.stringify({
          level: permanentlyFailed ? "error" : "warn",
          event: "outbox_dispatch_failed",
          outboxEventId: event.id,
          errorName: error?.name ?? "Error",
          permanent: permanentlyFailed
        }));
      }
    }
    return { claimed: events.length, published, failed };
  }

  function schedule() {
    if (stopped) return;
    timer = setTimeout(() => {
      activeRun = runOnce()
        .catch((error) => log(JSON.stringify({
          level: "error",
          event: "outbox_poll_failed",
          errorName: error?.name ?? "Error"
        })))
        .finally(() => {
          activeRun = null;
          schedule();
        });
    }, pollIntervalMs);
    timer.unref?.();
  }

  return Object.freeze({
    runOnce,
    start() {
      if (!stopped) return;
      stopped = false;
      schedule();
    },
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      await activeRun;
    }
  });
}
