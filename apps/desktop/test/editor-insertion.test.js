import { expect, test } from "bun:test";
import { runEditorInsertion } from "../src/services/editor-insertion.js";

test.each(["view replaced", "view destroyed", "mutation started"])(
  "does not adopt a completed insertion after %s", async (change) => {
    const view = { isDestroyed: false };
    let current = view;
    let valid = true;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const inserted = [];
    const operation = runEditorInsertion({ view, getCurrentView: () => current,
      isCurrent: () => valid, prepare: async () => { await gate; return { assetId: "asset" }; },
      insert: (...args) => inserted.push(args)
    });
    if (change === "view replaced") current = {};
    if (change === "view destroyed") view.isDestroyed = true;
    if (change === "mutation started") valid = false;
    release();
    await expect(operation).rejects.toThrow("editor_insertion_session_changed");
    expect(inserted).toEqual([]);
  }
);

test("permits insertion into the original unchanged view", async () => {
  const view = { isDestroyed: false };
  const stored = { assetId: "asset" };
  let result;
  await runEditorInsertion({ view, getCurrentView: () => view, isCurrent: () => true,
    prepare: async (assertCurrent) => { assertCurrent(); return stored; },
    insert: (...args) => { result = args; }
  });
  expect(result).toEqual([view, stored]);
});
