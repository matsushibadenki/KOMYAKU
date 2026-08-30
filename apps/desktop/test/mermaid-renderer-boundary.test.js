import { describe, expect, test } from "bun:test";
import {
  isMermaidRenderRequest,
  isMermaidRenderResult
} from "../src/services/mermaid-renderer-protocol.js";

const tauriRoot = new URL("../src-tauri/", import.meta.url);

async function json(path) {
  return Bun.file(new URL(path, tauriRoot)).json();
}

describe("Mermaid renderer privilege boundary", () => {
  test("gives the hidden renderer only bounded event transport", async () => {
    const capability = await json("capabilities/mermaid-renderer.json");
    expect(capability.windows).toEqual(["mermaid-renderer"]);
    expect(capability.permissions).toEqual([
      "core:event:allow-listen",
      "core:event:allow-emit-to"
    ]);
    expect(capability.permissions.some((permission) =>
      permission.startsWith("sql:") || permission.startsWith("allow-") || permission === "core:default"
    )).toBe(false);
  });

  test("keeps native commands and SQL on the main window", async () => {
    const capability = await json("capabilities/default.json");
    expect(capability.windows).toEqual(["main"]);
    expect(capability.permissions).toContain("sql:allow-execute");
    expect(capability.permissions).toContain("allow-load-provider-credential");
    expect(capability.permissions).toContain("allow-load-cloud-session");
  });

  test("declares a hidden renderer window with its dedicated entry mode", async () => {
    const config = await json("tauri.conf.json");
    const renderer = config.app.windows.find(({ label }) => label === "mermaid-renderer");
    expect(renderer).toMatchObject({
      url: "/?mode=mermaid-renderer",
      visible: false,
      resizable: false,
      skipTaskbar: true
    });
  });

  test("accepts only bounded request and result envelopes", () => {
    expect(isMermaidRenderRequest({ requestId: "abc-123", source: "flowchart LR\nA-->B", language: "ja" }))
      .toBe(true);
    expect(isMermaidRenderRequest({ requestId: "../bad", source: "A".repeat(20_001), language: "ja" }))
      .toBe(false);
    expect(isMermaidRenderResult({
      requestId: "abc-123", ok: true, preview: { kind: "static-html", document: "<html></html>" }
    })).toBe(true);
    expect(isMermaidRenderResult({ requestId: "abc-123", ok: true, preview: { kind: "raw-svg" } }))
      .toBe(false);
  });
});
