import { expect, test } from "bun:test";
import { prepareCloudPngInsertion } from "../src/services/cloud-image-insertion.js";
import { prepareCloudFileInsertion } from "../src/services/cloud-file-insertion.js";
import { runEditorInsertion } from "../src/services/editor-insertion.js";
import { abandonPreparedAsset, retainPreparedAsset } from "../src/services/prepared-asset.js";

test("cleanup failure preserves the cancellation error and does not insert", async () => {
  const view = {};
  let current = true;
  let releases = 0;
  await expect(runEditorInsertion({ view, getCurrentView: () => view, isCurrent: () => current,
    prepare: async () => {
      current = false;
      return retainPreparedAsset({}, async () => { releases += 1; throw new Error("offline"); });
    }, insert: () => { throw new Error("must not insert"); }
  })).rejects.toThrow("editor_insertion_session_changed");
  expect(releases).toBe(1);
});

test("an uncertain editor transaction failure never releases a possibly adopted reference", async () => {
  const view = {};
  let releases = 0;
  await expect(runEditorInsertion({ view, getCurrentView: () => view, isCurrent: () => true,
    prepare: async () => retainPreparedAsset({}, async () => { releases += 1; }),
    insert: () => { throw new Error("transaction outcome unknown"); }
  })).rejects.toThrow("transaction outcome unknown");
  expect(releases).toBe(0);
});

for (const kind of ["png", "file"]) {
  for (const cancel of [false, true]) {
    test(`${kind} ${cancel ? "cancellation releases only its staging reference" : "adoption retains the reference"}`, async () => {
      let current = true;
      let released = [];
      let inserted = false;
      let attributes;
      const view = {};
      const receipt = { assetId: "asset", referenceId: "staging", inspectionStatus: "accepted",
        detectedMediaType: "text/plain", policyVersion: "baseline-signature-v1", width: 1, height: 1 };
      const apiClient = { uploadPngAsset: async () => receipt, uploadFileAsset: async () => receipt,
        releaseAssetReference: async (input) => { released.push(input); } };
      const operation = runEditorInsertion({ view, getCurrentView: () => view, isCurrent: () => current,
        prepare: async () => {
          const input = { token: "session", workspaceId: "workspace", documentId: "document",
            nodeId: "node", bytes: new Uint8Array([1]), apiClient, altText: "image",
            fileName: "test.txt", mediaType: "text/plain" };
          attributes = await (kind === "png" ? prepareCloudPngInsertion(input) : prepareCloudFileInsertion(input));
          current = !cancel;
          return attributes;
        }, insert: () => { inserted = true; }
      });
      if (cancel) await expect(operation).rejects.toThrow("editor_insertion_session_changed");
      else await operation;
      expect(inserted).toBe(!cancel);
      await abandonPreparedAsset(attributes);
      expect(released).toEqual(cancel ? [{ token: "session", workspaceId: "workspace",
        assetId: "asset", referenceId: "staging" }] : []);
      expect(JSON.stringify(attributes)).not.toContain("session");
      expect(JSON.stringify(attributes)).not.toContain("staging");
    });
  }
}
