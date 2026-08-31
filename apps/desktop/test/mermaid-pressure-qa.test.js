import { expect, test } from "bun:test";
import { runMermaidPressureQa } from "../src/services/mermaid-pressure-qa.js";
import { MERMAID_PREVIEW_QA_TIMEOUT_SOURCE } from "../src/services/mermaid-renderer-protocol.js";

test("Mermaid pressure QA requires bounded concurrency, fail-closed timeout, and recovery", async () => {
  let pending = 0;
  let timeoutWave = false;
  const render = async (source) => {
    if (source.length > 20_000) throw new Error("invalid_mermaid_source");
    if (source !== MERMAID_PREVIEW_QA_TIMEOUT_SOURCE) return { kind: "static-html" };
    if (pending >= 8) throw new Error("mermaid_renderer_busy");
    pending += 1;
    return new Promise((_resolve, reject) => {
      setTimeout(() => {
        pending -= 1;
        if (!timeoutWave) {
          timeoutWave = true;
          reject(new Error("mermaid_render_timeout"));
        } else {
          reject(new Error("mermaid_renderer_restarted"));
        }
      }, 5);
    });
  };
  expect(await runMermaidPressureQa(render)).toBe("pressure-recovered");
});
