export function idempotencyBoundary({ service, scope }) {
  if (!service?.execute) throw new Error("Idempotency service is required");
  if (typeof scope !== "function") throw new Error("Idempotency scope resolver is required");

  return async function requireIdempotencyKey(context, next) {
    const key = context.req.header("Idempotency-Key");
    if (!key) {
      context.header("Cache-Control", "no-store");
      return context.json({ error: "idempotency_key_required" }, 400);
    }
    if (key.length < 8 || key.length > 200) {
      context.header("Cache-Control", "no-store");
      return context.json({ error: "invalid_idempotency_key" }, 400);
    }
    const requestBytes = new Uint8Array(await context.req.raw.clone().arrayBuffer());
    const resolvedScope = await scope(context);
    context.set("executeIdempotent", (operation) => service.execute({
      scope: resolvedScope,
      key,
      requestBytes,
      operation
    }));
    await next();
  };
}
