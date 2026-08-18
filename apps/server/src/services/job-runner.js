export class JobExecutionError extends Error {
  constructor(code, { retryable = true } = {}) {
    super(code);
    this.name = "JobExecutionError";
    this.code = code;
    this.retryable = retryable;
  }
}

function retryDelaySeconds(attemptCount) {
  return Math.min(900, 5 * (2 ** Math.min(Math.max(attemptCount - 1, 0), 8)));
}

export function createJobRunner({
  repository,
  handlers,
  instanceId,
  batchSize = 10,
  leaseSeconds = 60,
  pollIntervalMs = 1_000,
  log = console.info
}) {
  if (!repository?.claimBatch || !repository?.complete || !repository?.fail) {
    throw new Error("Job repository is required");
  }
  const entries = Object.entries(handlers ?? {}).filter(([, handler]) => typeof handler === "function");
  if (entries.length === 0) throw new Error("At least one job handler is required");
  if (!instanceId) throw new Error("Job runner instance ID is required");

  let stopped = true;
  let timer = null;
  let activeRun = null;

  async function runOnce() {
    const summary = { claimed: 0, completed: 0, retried: 0, failed: 0 };
    for (const [jobType, handler] of entries) {
      const jobs = await repository.claimBatch({ jobType, leaseOwner: instanceId, leaseSeconds, batchSize });
      summary.claimed += jobs.length;
      for (const job of jobs) {
        try {
          await handler(job);
          await repository.complete({ job, leaseOwner: instanceId });
          summary.completed += 1;
        } catch (error) {
          const retryable = error instanceof JobExecutionError ? error.retryable : true;
          const errorCode = error instanceof JobExecutionError ? error.code : "unexpected_error";
          const result = await repository.fail({
            job,
            leaseOwner: instanceId,
            retryable,
            delaySeconds: retryDelaySeconds(job.attemptCount),
            errorCode
          });
          if (result.status === "queued") summary.retried += 1;
          else summary.failed += 1;
          log(JSON.stringify({
            level: result.status === "queued" ? "warn" : "error",
            event: "job_execution_failed",
            jobId: job.id,
            jobType: job.jobType,
            errorCode,
            outcome: result.status
          }));
        }
      }
    }
    return summary;
  }

  function schedule() {
    if (stopped) return;
    timer = setTimeout(() => {
      activeRun = runOnce()
        .catch((error) => log(JSON.stringify({
          level: "error", event: "job_poll_failed", errorName: error?.name ?? "Error"
        })))
        .finally(() => { activeRun = null; schedule(); });
    }, pollIntervalMs);
    timer.unref?.();
  }

  return Object.freeze({
    runOnce,
    start() { if (stopped) { stopped = false; schedule(); } },
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      await activeRun;
    }
  });
}
