import { abandonPreparedAsset, adoptPreparedAsset } from "./prepared-asset.js";

export async function runEditorInsertion({ view, getCurrentView, isCurrent, prepare, insert }) {
  const assertCurrent = () => {
    if (!view || view.isDestroyed || getCurrentView() !== view || !isCurrent()) {
      throw new Error("editor_insertion_session_changed");
    }
  };
  assertCurrent();
  const stored = await prepare(assertCurrent);
  try {
    assertCurrent();
  } catch (error) {
    // No editor transaction ran yet, so only the staging reference is released.
    // A failed release leaves reconciliation as the non-destructive fallback.
    try { await abandonPreparedAsset(stored); } catch { /* Preserve the insertion failure. */ }
    throw error;
  }
  insert(view, stored);
  adoptPreparedAsset(stored);
}
