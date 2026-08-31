import { describe, expect, test } from "bun:test";
import {
  isMermaidRenderRequest,
  isMermaidRenderResult,
  verifyMermaidRendererBoundary,
  verifyMermaidRendererSqlBoundary
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
    expect(capability.permissions).toContain("allow-list-quarantined-local-assets");
    expect(capability.permissions).toContain("allow-acl-boundary-canary");
    expect(capability.permissions).toContain("core:webview:allow-create-webview-window");
    expect(capability.permissions).toContain("core:window:allow-close");
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

  test("keeps packaged preview QA in a separate application identity", async () => {
    const config = await json("tauri.preview-qa.conf.json");
    expect(config).toMatchObject({
      productName: "KOMYAKU Preview QA",
      identifier: "app.komyaku.desktop.preview-qa"
    });
    expect(config.app.windows.find(({ label }) => label === "main")?.url).toBe("/?previewQa=1");
    expect(config.app.windows.find(({ label }) => label === "mermaid-renderer")?.url)
      .toBe("/?mode=mermaid-renderer&previewQa=1");
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

  test("fails closed unless the harmless main-only canary is denied", async () => {
    expect(await verifyMermaidRendererBoundary(async () => {
      throw new Error("not allowed");
    })).toBe(true);
    expect(await verifyMermaidRendererBoundary(async () => "main-command-accessible")).toBe(false);
    expect(await verifyMermaidRendererBoundary(null)).toBe(false);
  });

  test("fails closed unless the renderer is denied SQL plugin loading", async () => {
    const calls = [];
    expect(await verifyMermaidRendererSqlBoundary(async (command, payload) => {
      calls.push([command, payload]);
      throw new Error("not allowed");
    })).toBe(true);
    expect(calls).toEqual([["plugin:sql|load", { db: "sqlite:komyaku.db" }]]);
    expect(await verifyMermaidRendererSqlBoundary(async () => "sqlite:komyaku.db")).toBe(false);
    expect(await verifyMermaidRendererSqlBoundary(null)).toBe(false);
  });
});
