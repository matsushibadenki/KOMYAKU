const LEVELS = Object.freeze({ debug: 10, info: 20, warn: 30, error: 40 });
const SENSITIVE_KEY = /(?:authorization|cookie|password|secret|token|body|payload|content|document|email)/i;

function sanitize(value, key = "", depth = 0) {
  if (SENSITIVE_KEY.test(key)) return "[REDACTED]";
  if (depth > 6) return "[TRUNCATED]";
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitize(item, "", depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).slice(0, 100).map(([name, item]) => [name, sanitize(item, name, depth + 1)])
    );
  }
  return String(value);
}

export function createStructuredLogger({
  level = "info",
  service = "komyaku-server",
  environment = "development",
  instanceId,
  write = console.log,
  now = () => new Date()
} = {}) {
  if (!(level in LEVELS)) throw new Error(`Unsupported log level: ${level}`);
  if (!instanceId) throw new Error("Logger instance ID is required");
  const threshold = LEVELS[level];

  function log(input) {
    let event = input;
    if (typeof input === "string") {
      try { event = JSON.parse(input); } catch { event = { level: "error", event: "invalid_log_input" }; }
    }
    const eventLevel = event?.level in LEVELS ? event.level : "info";
    if (LEVELS[eventLevel] < threshold) return;
    write(JSON.stringify({
      ...sanitize(event),
      timestamp: now().toISOString(),
      level: eventLevel,
      service,
      environment,
      instanceId
    }));
  }

  return Object.freeze({ log });
}
