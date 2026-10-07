import { expect, test } from "bun:test";
import corpus from "./fixtures/native-conformance.json";
import { safeParseCanonicalDocument } from "../src/index.js";

// Rust consumes this exact corpus via include_str!. These inputs already carry
// normalized defaults; external-input normalization is a separate contract.
for (const { name, document, valid } of corpus) {
  test(`native/shared Canonical contract: ${name}`, () => {
    expect(safeParseCanonicalDocument(document).success).toBe(valid);
  });
}
