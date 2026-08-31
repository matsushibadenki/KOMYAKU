import { resolveLocalPngPreview } from "./local-image-preview.js";
import { resolveCloudPngPreview } from "./cloud-image-preview.js";

export const LOCAL_EDITOR_WORKSPACE = Object.freeze({ mode: "local" });

export function createEditorImagePreviewResolver(workspace, {
  localResolver = resolveLocalPngPreview,
  cloudResolver = resolveCloudPngPreview
} = {}) {
  if (workspace?.mode === "local") return localResolver;
  if (
    workspace?.mode !== "cloud" ||
    typeof workspace.token !== "string" || workspace.token.length === 0 ||
    typeof workspace.workspaceId !== "string" || workspace.workspaceId.length === 0
  ) {
    throw new Error("invalid_editor_workspace");
  }
  const { token, workspaceId } = workspace;
  return (input) => cloudResolver({ ...input, token, workspaceId });
}

