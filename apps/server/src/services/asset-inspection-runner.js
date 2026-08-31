export function createAssetInspectionRunner({ service, pollIntervalMs = 1000, log = () => {} }) {
  if (!service?.runOnce) throw new Error("Asset inspection service is required");
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 100 || pollIntervalMs > 60_000) {
    throw new Error("Asset inspection poll interval must be between 100 and 60000 milliseconds");
  }
  let active = false;
  let timer = null;
  let current = null;

  const schedule = () => {
    if (!active) return;
    timer = setTimeout(run, pollIntervalMs);
    timer.unref?.();
  };
  const run = () => {
    if (!active || current) return;
    current = service.runOnce()
      .then((summary) => {
        if (summary.claimed > 0 || summary.errors > 0) {
          log({ level: summary.errors > 0 ? "warn" : "info", event: "asset_inspection_batch", ...summary });
        }
      })
      .catch(() => log({ level: "error", event: "asset_inspection_runner_failed" }))
      .finally(() => {
        current = null;
        schedule();
      });
  };

  return Object.freeze({
    start() {
      if (active) return;
      active = true;
      run();
    },
    async stop() {
      active = false;
      if (timer) clearTimeout(timer);
      timer = null;
      await current;
    }
  });
}
