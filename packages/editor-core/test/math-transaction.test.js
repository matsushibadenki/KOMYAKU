import { expect, test } from "bun:test";
import { createEmptyDocument } from "@komyaku/document-schema";
import { canonicalToEditorDocument, createEditorState, editorToCanonicalDocument, mathSourceTransaction } from "../src/index.js";

test("math source transactions preserve IDs, metadata, siblings and reject stale edits", () => {
  const canonical = createEmptyDocument();
  const state = createEditorState({ document: canonicalToEditorDocument(canonical) });
  const next = state.apply(mathSourceTransaction(state, { source: String.raw`\int_0^1 x^2 dx` }));
  const saved = editorToCanonicalDocument(next.doc);
  const math = saved.content.find((n) => n.type === "math_block");
  expect(math.source).toBe(String.raw`\int_0^1 x^2 dx`);
  expect(math.id).toBeTruthy();
  const updated = next.apply(mathSourceTransaction(next, { nodeId: math.id, expectedSource: math.source,
    source: "x^2=1", assumptions: { x: { domain: "real" } } }));
  const result = editorToCanonicalDocument(updated.doc);
  const equation = result.content.find((n) => n.type === "math_block");
  expect(equation.id).toBe(math.id);
  expect(equation.source).toBe("x^2=1");
  expect(equation.extensions["dev.symbio.math"].assumptions.x.domain).toBe("real");
  expect(equation.renderArtifacts).toEqual([]);
  expect(() => mathSourceTransaction(updated, { nodeId: math.id, expectedSource: math.source, source: "0" })).toThrow("math_source_changed");
  expect(() => mathSourceTransaction(updated, { nodeId: crypto.randomUUID(), expectedSource: "", source: "0" })).toThrow("math_node_not_found");
});
test("canonical editing retains the wider KOMYAKU source limit", () => {
  const state = createEditorState({ document: canonicalToEditorDocument(createEmptyDocument()) });
  expect(() => mathSourceTransaction(state, { source: "x".repeat(2049) })).not.toThrow();
  expect(() => mathSourceTransaction(state, { source: "x".repeat(20_001) })).toThrow();
});
