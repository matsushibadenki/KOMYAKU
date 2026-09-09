import { expect, test } from "bun:test";
import { HISTORY_QA_IDENTIFIER, runPackagedHistoryQa } from "../src/services/packaged-history-qa.js";

function harness() {
  let record = null;
  let writes = 0;
  const ports = {
    identifier: async () => HISTORY_QA_IDENTIFIER,
    load: async () => structuredClone(record),
    save: async (next) => {
      if (record && next.localRevision <= record.localRevision) {
        throw Object.assign(new Error("stale"), { code: "stale_local_revision" });
      }
      writes += 1;
      record = structuredClone(next);
    },
    mutate: async ({ title }) => {
      record.content.metadata.title = title;
      record.localRevision += 1;
      writes += 1;
      return { localRevision: record.localRevision };
    }
  };
  return { ports, writes: () => writes };
}

test("history QA refuses the normal profile before reading or writing", async () => {
  const { ports, writes } = harness();
  let reads = 0;
  await expect(runPackagedHistoryQa({ ...ports,
    identifier: async () => "app.komyaku.desktop",
    load: async () => { reads += 1; }
  })).rejects.toThrow("history_qa_profile_required");
  expect(reads).toBe(0);
  expect(writes()).toBe(0);
});

test("history QA verifies an exact archive and recovers without rewriting", async () => {
  const { ports, writes } = harness();
  expect(await runPackagedHistoryQa(ports)).toBe("saved-export-verified");
  expect(writes()).toBe(3);
  expect(await runPackagedHistoryQa(ports)).toBe("recovered");
  expect(writes()).toBe(3);
});

test("history QA fails on partial state instead of overwriting evidence", async () => {
  const { ports, writes } = harness();
  await expect(runPackagedHistoryQa({ ...ports, load: async () => ({ localRevision: 1 }) }))
    .rejects.toThrow("history_qa_snapshot_mismatch");
  expect(writes()).toBe(0);
});

test("history QA does not mistake an arbitrary storage error for stale rejection", async () => {
  const { ports } = harness();
  await expect(runPackagedHistoryQa({ ...ports, save: async (record) => {
    if (record.localRevision === 2) throw new Error("disk unavailable");
    return ports.save(record);
  } })).rejects.toThrow("disk unavailable");
});
