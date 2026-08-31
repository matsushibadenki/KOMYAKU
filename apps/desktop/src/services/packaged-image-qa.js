import { insertCollaborativeImage } from "@komyaku/editor-core";
import { storeLocalPngForInsertion } from "./local-image-insertion.js";

const QA_ALT_TEXT = "KOMYAKU packaged PNG restart fixture";
const QA_PNG = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1,
  0, 0, 0, 1, 8, 4, 0, 0, 0, 181, 28, 12, 2, 0, 0, 0, 11, 73, 68, 65, 84,
  120, 218, 99, 100, 248, 15, 0, 1, 5, 1, 1, 39, 24, 227, 102, 0, 0, 0, 0,
  73, 69, 78, 68, 174, 66, 96, 130
]);

function findFixture(view) {
  let found = false;
  view.state.doc.descendants((node) => {
    if (node.type.name === "image" && node.attrs.altText === QA_ALT_TEXT) found = true;
  });
  return found;
}

function waitForPreview(mount, { timeoutMs = 5000 } = {}) {
  if (mount.querySelector(".image-preview-frame")) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const observer = new MutationObserver(() => {
      if (!mount.querySelector(".image-preview-frame")) return;
      window.clearTimeout(timeout);
      observer.disconnect();
      resolve();
    });
    const timeout = window.setTimeout(() => {
      observer.disconnect();
      reject(new Error("packaged_image_preview_timeout"));
    }, timeoutMs);
    observer.observe(mount, { childList: true, subtree: true });
  });
}

export async function runPackagedImageQa({ view, mount, store = storeLocalPngForInsertion }) {
  const recovery = findFixture(view);
  if (!recovery) {
    const stored = await store({ bytes: QA_PNG, altText: QA_ALT_TEXT });
    insertCollaborativeImage(view, stored);
  }
  await waitForPreview(mount);
  return recovery ? "recovered" : "inserted";
}

