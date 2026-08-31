import { describe, expect, test } from "bun:test";
import {
  createEditorImagePreviewResolver,
  LOCAL_EDITOR_WORKSPACE
} from "../src/services/editor-workspace-preview.js";

describe("editor Workspace image preview selection", () => {
  test("uses the local resolver without adding Cloud authority", async () => {
    const calls = [];
    const resolver = createEditorImagePreviewResolver(LOCAL_EDITOR_WORKSPACE, {
      localResolver: async (input) => { calls.push(input); return "local"; }
    });
    expect(await resolver({ assetId: "asset" })).toBe("local");
    expect(calls).toEqual([{ assetId: "asset" }]);
  });

  test("binds a Cloud resolver to one memory-only Session and Workspace", async () => {
    const calls = [];
    const resolver = createEditorImagePreviewResolver({
      mode: "cloud",
      token: "memory-session",
      workspaceId: "workspace-1"
    }, {
      cloudResolver: async (input) => { calls.push(input); return "cloud"; }
    });
    expect(await resolver({ assetId: "asset-1", altText: "Diagram" })).toBe("cloud");
    expect(calls).toEqual([{
      assetId: "asset-1",
      altText: "Diagram",
      token: "memory-session",
      workspaceId: "workspace-1"
    }]);
  });

  test("does not silently fall back for an incomplete Cloud Workspace", () => {
    expect(() => createEditorImagePreviewResolver({ mode: "cloud", token: "", workspaceId: "workspace" }))
      .toThrow("invalid_editor_workspace");
  });
});
