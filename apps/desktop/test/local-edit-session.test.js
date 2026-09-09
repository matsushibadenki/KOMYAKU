import { describe, expect, test } from "bun:test";
import {
  createLocalEditSession,
  prepareLocalEditTransition
} from "../src/services/local-edit-session.js";

describe("local document edit session", () => {
  test("does not permit navigation when the edit changes during a durable save", async () => {
    let release;
    let current = true;
    const gate = new Promise((resolve) => { release = resolve; });
    const transition = prepareLocalEditTransition({
      isComposing: false, cancelScheduledSave: () => {},
      save: async () => { await gate; return { durable: true }; },
      isCurrent: () => current
    });
    current = false;
    release();
    expect(await transition).toEqual({ ok: false, reason: "edit_changed" });
  });

  test("serializes saves and assigns monotonic revisions inside one document session", async () => {
    const session = createLocalEditSession({ documentId: "document-a", localRevision: 4 });
    const revisions = [];
    let releaseFirst;
    const firstGate = new Promise((resolve) => { releaseFirst = resolve; });

    const first = session.enqueue(async (revision) => {
      revisions.push(revision);
      await firstGate;
    });
    const second = session.enqueue(async (revision) => { revisions.push(revision); });

    await Promise.resolve();
    expect(revisions).toEqual([5]);
    releaseFirst();
    await Promise.all([first, second]);
    expect(revisions).toEqual([5, 6]);
    expect(session.revision).toBe(6);
  });

  test("stops queued writes after a failure until an explicit retry", async () => {
    const session = createLocalEditSession({ documentId: "document-a", localRevision: 2 });
    const writes = [];
    const failed = session.enqueue(async (revision) => {
      writes.push(revision);
      throw Object.assign(new Error("disk unavailable"), { code: "disk_unavailable" });
    });
    const queued = session.enqueue(async (revision) => { writes.push(revision); });

    await expect(failed).rejects.toMatchObject({ code: "disk_unavailable" });
    await expect(queued).rejects.toMatchObject({ code: "local_persistence_blocked" });
    expect(writes).toEqual([3]);
    expect(session.revision).toBe(2);

    await session.enqueue(async (revision) => { writes.push(revision); }, { retry: true });
    expect(writes).toEqual([3, 3]);
    expect(session.revision).toBe(3);
    expect(session.blocked).toBe(false);
  });

  test("keeps revisions isolated when another document becomes active", async () => {
    const first = createLocalEditSession({ documentId: "document-a", localRevision: 8 });
    const second = createLocalEditSession({ documentId: "document-b", localRevision: 1 });
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const oldSave = first.enqueue(async () => gate);
    const newSave = second.enqueue(async () => undefined);

    await newSave;
    release();
    await oldSave;
    expect(first.revision).toBe(9);
    expect(second.revision).toBe(2);
  });

  test("cancels a pending autosave and requires a durable save before navigation", async () => {
    const events = [];
    const prepared = await prepareLocalEditTransition({
      isComposing: false,
      cancelScheduledSave: () => events.push("cancel"),
      save: async () => { events.push("save"); return { durable: true, revision: 3 }; }
    });
    expect(events).toEqual(["cancel", "save"]);
    expect(prepared).toMatchObject({ ok: true, checkpoint: { durable: true, revision: 3 } });

    const failed = await prepareLocalEditTransition({
      isComposing: false,
      cancelScheduledSave: () => undefined,
      save: async () => null
    });
    expect(failed).toEqual({ ok: false, reason: "durable_save_required" });
  });

  test("does not cancel or save while an IME composition is active", async () => {
    const events = [];
    const prepared = await prepareLocalEditTransition({
      isComposing: true,
      cancelScheduledSave: () => events.push("cancel"),
      save: async () => { events.push("save"); return { durable: true }; }
    });
    expect(prepared).toEqual({ ok: false, reason: "composition_active" });
    expect(events).toEqual([]);
  });

  test.each([{}, { durable: false }, { durable: "true" }, { revision: 3 }])(
    "rejects a checkpoint without explicit durable persistence: %j", async (checkpoint) => {
      const prepared = await prepareLocalEditTransition({
        isComposing: false,
        cancelScheduledSave: () => undefined,
        save: async () => checkpoint
      });
      expect(prepared).toEqual({ ok: false, reason: "durable_save_required" });
    }
  );

  test("a failed transition does not allow another queued write until retry", async () => {
    const session = createLocalEditSession({ documentId: "document-a", localRevision: 7 });
    const writes = [];
    const save = (retry = false) => session.enqueue(async (revision) => {
      writes.push(revision);
      if (!retry) throw new Error("disk unavailable");
      return { durable: true };
    }, { retry });
    await expect(prepareLocalEditTransition({
      isComposing: false,
      cancelScheduledSave: () => undefined,
      save: () => save()
    })).rejects.toThrow("disk unavailable");
    await expect(save()).rejects.toMatchObject({ code: "local_persistence_blocked" });
    expect(session.revision).toBe(7);
    await save(true);
    expect(session.revision).toBe(8);
    expect(writes).toEqual([8, 8]);
  });

  test("fails closed before writing an unsafe revision, including on retry", async () => {
    const session = createLocalEditSession({
      documentId: "document-a", localRevision: Number.MAX_SAFE_INTEGER
    });
    let writes = 0;
    const save = async () => { writes += 1; };
    await expect(session.enqueue(save)).rejects.toMatchObject({ code: "invalid_local_revision" });
    expect(session.blocked).toBe(true);
    await expect(session.enqueue(save, { retry: true })).rejects.toMatchObject({ code: "invalid_local_revision" });
    expect(session.revision).toBe(Number.MAX_SAFE_INTEGER);
    expect(writes).toBe(0);
  });
});
