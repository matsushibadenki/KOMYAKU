import {
  MERMAID_PREVIEW_QA_TIMEOUT_SOURCE,
  MERMAID_RENDER_MAX_PENDING
} from "./mermaid-renderer-protocol.js";

function denseFlowchart(edgeCount = 200) {
  const edges = [];
  for (let index = 0; index < edgeCount; index += 1) {
    edges.push(`N${index}-->N${index + 1}`);
  }
  return `flowchart LR\n${edges.join("\n")}`;
}

export async function runMermaidPressureQa(render) {
  if (typeof render !== "function") throw new Error("invalid_pressure_renderer");
  try {
    await render("A".repeat(20_001), { language: "en" });
    throw new Error("oversized_source_accepted");
  } catch (error) {
    if (error?.message !== "invalid_mermaid_source") throw error;
  }

  await render(denseFlowchart(), { language: "en" });

  const held = Array.from({ length: MERMAID_RENDER_MAX_PENDING }, () =>
    render(MERMAID_PREVIEW_QA_TIMEOUT_SOURCE, { language: "en" }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  try {
    await render(MERMAID_PREVIEW_QA_TIMEOUT_SOURCE, { language: "en" });
    throw new Error("pending_limit_not_enforced");
  } catch (error) {
    if (error?.message !== "mermaid_renderer_busy") throw error;
  }

  const settled = await Promise.allSettled(held);
  const errors = settled.map((result) => result.status === "rejected" ? result.reason?.message : "resolved");
  if (!errors.includes("mermaid_render_timeout") || errors.some((error) =>
    !["mermaid_render_timeout", "mermaid_renderer_restarted"].includes(error))) {
    throw new Error("pressure_requests_did_not_fail_closed");
  }

  await render("flowchart LR\nPressure --> Restart --> Ready", { language: "en" });
  return "pressure-recovered";
}
