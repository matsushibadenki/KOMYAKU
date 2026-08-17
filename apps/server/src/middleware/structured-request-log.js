export function structuredRequestLog({ log }) {
  return async (context, next) => {
    const startedAt = performance.now();
    await next();

    // Do not log URL paths: unlisted share tokens can be present in URLs.
    log(JSON.stringify({
      level: "info",
      event: "request_completed",
      requestId: context.get("requestId"),
      method: context.req.method,
      status: context.res.status,
      durationMs: Math.round(performance.now() - startedAt)
    }));
  };
}

