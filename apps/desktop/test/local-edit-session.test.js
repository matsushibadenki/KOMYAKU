import { describe, expect, test } from "bun:test";
import {
  createLocalEditSession,
  prepareLocalEditTransition
} from "../src/services/local-edit-session.js";

describe("local document edit session", () => {
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
});
