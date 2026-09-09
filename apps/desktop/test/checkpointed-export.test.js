import { expect, test } from "bun:test";
import { runCheckpointedExport } from "../src/services/checkpointed-export.js";
import { prepareLocalEditTransition } from "../src/services/local-edit-session.js";

test("export uses the newly persisted checkpoint in build-before-delivery order", async () => {
  const events = [];
  const checkpoint = { durable: true, document: { text: "dirty draft / 最新 / 最新" } };
  const result = await runCheckpointedExport({
    prepare: async () => { events.push("save"); return { checkpoint, isCurrent: () => true }; },
    build: async (saved) => { expect(saved).toBe(checkpoint); events.push("build"); return saved.document.text; },
    deliver: async (output) => { expect(output).toBe(checkpoint.document.text); events.push("deliver"); }
  });
  expect(result).toBe(checkpoint.document.text);
  expect(events).toEqual(["save", "build", "deliver"]);
});

test("export rejects active composition before saving or delivering", async () => {
  let calls = 0;
  await expect(runCheckpointedExport({
    prepare: async () => {
      const prepared = await prepareLocalEditTransition({
        isComposing: true, cancelScheduledSave: () => { calls += 1; },
        save: async () => { calls += 1; return { durable: true }; }
      });
      return prepared.ok ? { checkpoint: prepared.checkpoint, isCurrent: () => true } : null;
    },
    build: async () => { calls += 1; }, deliver: async () => { calls += 1; }
  })).rejects.toThrow("durable_checkpoint_required");
  expect(calls).toBe(0);
});

test.each([null, { checkpoint: { durable: false }, isCurrent: () => true }])(
  "export fails closed without durable preparation", async (prepared) => {
    let delivered = false;
    await expect(runCheckpointedExport({ prepare: async () => prepared,
      build: async () => "bytes", deliver: async () => { delivered = true; }
    })).rejects.toThrow("durable_checkpoint_required");
    expect(delivered).toBe(false);
  }
);

test("edits during archive creation prevent delivery", async () => {
  let current = true;
  let release;
  let started;
  const gate = new Promise((resolve) => { release = resolve; });
  const building = new Promise((resolve) => { started = resolve; });
  let delivered = false;
  const operation = runCheckpointedExport({
    prepare: async () => ({ checkpoint: { durable: true }, isCurrent: () => current }),
    build: async () => { started(); await gate; return "old bytes"; },
    deliver: async () => { delivered = true; }
  });
  await building;
  current = false;
  release();
  await expect(operation).rejects.toThrow("local_edit_changed");
  expect(delivered).toBe(false);
});

test.each(["prepare", "build", "deliver"])("export propagates %s failure without reporting success", async (stage) => {
  const events = [];
  const failure = new Error(`${stage}_failed`);
  const run = (name, result) => async () => {
    events.push(name);
    if (stage === name) throw failure;
    return result;
  };
  await expect(runCheckpointedExport({
    prepare: run("prepare", { checkpoint: { durable: true }, isCurrent: () => true }),
    build: run("build", "bytes"), deliver: run("deliver")
  })).rejects.toBe(failure);
  expect(events).toEqual(["prepare", "build", "deliver"].slice(0, ["prepare", "build", "deliver"].indexOf(stage) + 1));
});
