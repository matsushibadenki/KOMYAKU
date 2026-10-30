import { blockNodeSchema, createNodeId } from "@komyaku/document-schema";
export function mathSourceTransaction(state, { source, nodeId = null, expectedSource, assumptions = {}, variable = "x" }) {
  if (typeof source !== "string" || source.length > 20_000 || typeof variable !== "string"
    || !assumptions || typeof assumptions !== "object" || Array.isArray(assumptions)) throw new Error("invalid_math_source");
  if (nodeId) {
    let found;
    state.doc.descendants((node, pos) => {
      if (node.attrs.nodeId === nodeId && ["math_inline", "math_block"].includes(node.type.name)) found = { node, pos };
    });
    if (!found) throw new Error("math_node_not_found");
    if (found.node.attrs.source !== expectedSource) throw new Error("math_source_changed");
    return state.tr.setNodeMarkup(found.pos, undefined, { ...found.node.attrs, source,
      extensions: { ...found.node.attrs.extensions, "dev.symbio.math": { assumptions, variable } }
    }, found.node.marks);
  }
  const canonical = blockNodeSchema.parse({ id: createNodeId(), schemaVersion: 1, type: "math_block", source,
    sourceType: "latex", displayMode: "block", metadata: {}, extensions: { "dev.symbio.math": { assumptions, variable } }, renderArtifacts: [] });
  const { id, type, ...attrs } = canonical;
  return state.tr.replaceSelectionWith(state.schema.nodes.math_block.create({ ...attrs, nodeId: id })).scrollIntoView();
}
