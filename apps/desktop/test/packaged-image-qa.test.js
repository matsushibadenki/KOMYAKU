import { expect, test } from "bun:test";
import { runPackagedImageQa } from "../src/services/packaged-image-qa.js";

test("packaged image QA recognizes a recovered Canonical fixture without rewriting its Asset", async () => {
  const view = {
    state: {
      doc: {
        descendants(visitor) {
          visitor({ type: { name: "image" }, attrs: { altText: "KOMYAKU packaged PNG restart fixture" } });
        }
      }
    }
  };
  const mount = { querySelector: () => ({ nodeName: "IFRAME" }) };
  const status = await runPackagedImageQa({
    view,
    mount,
    store: async () => { throw new Error("recovery_must_not_rewrite_asset"); }
  });
  expect(status).toBe("recovered");
});
