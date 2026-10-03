import { describe, expect, test } from "bun:test";
import { createEmptyDocument } from "@komyaku/document-schema";
import {
  applyStoryWorkspaceCommand,
  characterKnowsFact,
  checkStoryGraphConsistency,
  compareStoryPathMerge,
  encodeStoryWorkspaceSnapshot,
  parseStoryGraph,
  parseStoryWorkspace,
  readStoryState,
  STORY_GRAPH_SCHEMA_ID,
  STORY_WORKSPACE_SCHEMA_ID,
  traceStoryImpact
} from "../src/index.js";

const id = (number) => `00000000-0000-4000-8000-${number.toString(16).padStart(12, "0")}`;

function fixture() {
  const document = createEmptyDocument({ id: id(1), nodeIdFactory: () => id(2) });
  const characterId = id(10);
  const factId = id(11);
  const nodes = {
    intro: id(20), routeA: id(21), routeB: id(22), join: id(23), ending: id(24)
  };
  const effect = (key, value) => ({ entityId: characterId, key, operation: "set", value });
  const graph = {
    schemaId: STORY_GRAPH_SCHEMA_ID, schemaVersion: 1, id: id(3), documentId: document.id,
    entities: [
      { id: characterId, type: "character", name: "太郎",
        initialState: { knowledge: [], location: "Tokyo" }, metadata: {}, extensions: {} },
      { id: factId, type: "fact", name: "鍵の所在", initialState: {}, metadata: {}, extensions: {} }
    ],
    nodes: [
      { id: nodes.intro, kind: "content", subtype: "chapter", title: "第1章",
        documentRefs: [{ nodeId: id(2) }], preconditions: [], effects: [], metadata: {},
        position: { x: 0, y: 0 }, extensions: {} },
      { id: nodes.routeA, kind: "content", subtype: "scene", title: "Aルート",
        documentRefs: [], preconditions: [], effects: [
          { entityId: characterId, key: "knowledge", operation: "add", value: factId },
          effect("location", "Kyoto")
        ], metadata: {}, position: { x: 100, y: -50 }, extensions: {} },
      { id: nodes.routeB, kind: "content", subtype: "scene", title: "Bルート",
        documentRefs: [], preconditions: [], effects: [effect("location", "Osaka")],
        metadata: {}, position: { x: 100, y: 50 }, extensions: {} },
      { id: nodes.join, kind: "logic", subtype: "merge", title: "合流",
        documentRefs: [], preconditions: [{ entityId: characterId, key: "knowledge",
          operator: "contains", value: factId }], effects: [], metadata: {},
        position: { x: 200, y: 0 }, extensions: {} },
      { id: nodes.ending, kind: "structure", subtype: "conclusion", title: "結末",
        documentRefs: [], preconditions: [], effects: [], metadata: {},
        position: { x: 300, y: 0 }, extensions: {} }
    ],
    edges: [
      [30, nodes.intro, nodes.routeA, "alternative"],
      [31, nodes.intro, nodes.routeB, "alternative"],
      [32, nodes.routeA, nodes.join, "merge"],
      [33, nodes.routeB, nodes.join, "merge"],
      [34, nodes.join, nodes.ending, "sequence"],
      // Meaning relations may be cyclic; only reading-flow edges form a DAG.
      [35, nodes.routeA, nodes.routeB, "contradicts"],
      [36, nodes.routeB, nodes.routeA, "reference"]
    ].map(([number, from, to, type]) => ({ id: id(number), from, to, type,
      label: null, extensions: {} })),
    paths: [
      { id: id(40), name: "A route", nodeIds: [nodes.intro, nodes.routeA, nodes.join, nodes.ending], extensions: {} },
      { id: id(41), name: "B route", nodeIds: [nodes.intro, nodes.routeB, nodes.join, nodes.ending], extensions: {} }
    ],
    metadata: {}, extensions: {}
  };
  return { document, graph, characterId, factId, nodes };
}

describe("Canonical Story Graph v1", () => {
  test("keeps the Story Graph separate while validating Canonical references", () => {
    const { document, graph } = fixture();
    const workspace = parseStoryWorkspace({ schemaId: STORY_WORKSPACE_SCHEMA_ID,
      schemaVersion: 1, document, graph });
    expect(workspace.graph.documentId).toBe(document.id);
    const broken = structuredClone(graph);
    broken.nodes[0].documentRefs[0].nodeId = id(999);
    expect(() => parseStoryWorkspace({ schemaId: STORY_WORKSPACE_SCHEMA_ID,
      schemaVersion: 1, document, graph: broken })).toThrow(/missing_canonical_node_reference/);
  });

  test("rejects cyclic reading flow but permits cyclic semantic relations", () => {
    const { graph, nodes } = fixture();
    expect(parseStoryGraph(graph).edges).toHaveLength(7);
    const cyclic = structuredClone(graph);
    cyclic.edges.push({ id: id(50), from: nodes.ending, to: nodes.intro,
      type: "sequence", label: null, extensions: {} });
    expect(() => parseStoryGraph(cyclic)).toThrow(/cyclic_story_flow/);
  });

  test("encodes the combined Document and Graph deterministically", () => {
    const { document, graph } = fixture();
    const first = encodeStoryWorkspaceSnapshot({ schemaId: STORY_WORKSPACE_SCHEMA_ID,
      schemaVersion: 1, document, graph });
    const reordered = { graph: structuredClone(graph), document: structuredClone(document),
      schemaVersion: 1, schemaId: STORY_WORKSPACE_SCHEMA_ID };
    expect(encodeStoryWorkspaceSnapshot(reordered).json).toBe(first.json);
    expect(first.bytes.byteLength).toBeGreaterThan(0);
  });
});

describe("deterministic narrative consistency", () => {
  test("answers what a character knows at an exact point on one Story Path", () => {
    const { graph, characterId, factId, nodes } = fixture();
    expect(characterKnowsFact(graph, { pathId: id(40), nodeId: nodes.join,
      characterId, factId, phase: "before" })).toBe(true);
    expect(characterKnowsFact(graph, { pathId: id(41), nodeId: nodes.join,
      characterId, factId, phase: "before" })).toBe(false);
    expect(readStoryState(graph, { pathId: id(40), nodeId: nodes.join,
      entityId: characterId, key: "location" })).toBe("Kyoto");
  });

  test("finds every deterministic precondition failure across named paths", () => {
    const { graph, nodes } = fixture();
    const result = checkStoryGraphConsistency(graph);
    expect(result.consistent).toBe(false);
    expect(result.issues).toEqual([expect.objectContaining({
      code: "story_precondition_failed", nodeId: nodes.join, pathIndex: 2, pathId: id(41)
    })]);
    expect(result.warnings).toEqual([]);
  });

  test("explains why two routes cannot merge without changing either route", () => {
    const { graph, characterId, factId } = fixture();
    const result = compareStoryPathMerge(graph, id(40), id(41));
    expect(result.sharedPrefixNodeIds).toEqual([id(20)]);
    expect(result.sharedSuffixNodeIds).toEqual([id(23), id(24)]);
    expect(result.conflicts).toEqual([{
      entityId: characterId, key: "location", base: "Tokyo", ours: "Kyoto", theirs: "Osaka"
    }]);
    expect(result.issues).toContainEqual(expect.objectContaining({
      entityId: characterId, key: "knowledge", expected: factId, pathId: id(41)
    }));
    expect(result.mergeable).toBe(false);
  });

  test("allows routes whose state changes are independent", () => {
    const { graph, characterId } = fixture();
    const compatible = structuredClone(graph);
    compatible.nodes.find(({ id: nodeId }) => nodeId === id(21)).effects = [
      { entityId: characterId, key: "mood", operation: "set", value: "hopeful" }
    ];
    compatible.nodes.find(({ id: nodeId }) => nodeId === id(22)).effects = [
      { entityId: characterId, key: "location", operation: "set", value: "Kyoto" }
    ];
    compatible.nodes.find(({ id: nodeId }) => nodeId === id(23)).preconditions = [];
    expect(compareStoryPathMerge(compatible, id(40), id(41))).toMatchObject({
      conflicts: [], issues: [], mergeable: true
    });
  });

  test("returns a deterministic downstream impact closure for a changed scene", () => {
    const { graph, nodes } = fixture();
    const result = traceStoryImpact(graph, { nodeIds: [nodes.routeA] });
    expect(result.impacts.map(({ nodeId }) => nodeId)).toEqual([
      nodes.join, nodes.routeB, nodes.ending
    ]);
    expect(result.impacts[0]).toMatchObject({
      nodeId: nodes.join, viaNodeId: nodes.routeA, reason: "merge"
    });
  });
});


describe("atomic Story Workspace command contract", () => {
  function current() {
    const { document, graph } = fixture();
    return { revision: 7, workspace: { schemaId: STORY_WORKSPACE_SCHEMA_ID,
      schemaVersion: 1, document, graph } };
  }
  function command(state, operations) {
    return { documentId: state.workspace.document.id, graphId: state.workspace.graph.id,
      expectedRevision: state.revision, operations };
  }

  test("updates prose and its references together with one revision", () => {
    const state = current();
    const before = structuredClone(state);
    const document = structuredClone(state.workspace.document);
    document.content[0].id = id(200);
    const node = structuredClone(state.workspace.graph.nodes[0]);
    node.documentRefs = [{ nodeId: id(200) }];
    const input = command(state, [
      { type: "replace-document", document },
      { type: "put", collection: "nodes", value: node }
    ]);
    const result = applyStoryWorkspaceCommand(state, input);
    expect(result.revision).toBe(8);
    expect(result.workspace.document.content[0].id).toBe(id(200));
    expect(result.workspace.graph.nodes[0].documentRefs[0].nodeId).toBe(id(200));
    expect(state).toEqual(before);
    document.content[0].id = id(201);
    expect(result.workspace.document.content[0].id).toBe(id(200));
    expect(encodeStoryWorkspaceSnapshot(result.workspace).json).toBe(result.json);
  });

  test("rejects stale commands and commands for another workspace", () => {
    const state = current();
    const input = command(state, [{ type: "remove", collection: "paths", id: id(40) }]);
    expect(() => applyStoryWorkspaceCommand(state, { ...input, expectedRevision: 6 }))
      .toThrow(/stale_story_workspace_revision/);
    expect(() => applyStoryWorkspaceCommand(state, { ...input, graphId: id(999) }))
      .toThrow(/story_command_workspace_mismatch/);
    const result = applyStoryWorkspaceCommand(state, input);
    expect(() => applyStoryWorkspaceCommand(result, input)).toThrow(/stale_story_workspace_revision/);
  });

  test("fails the entire batch for dangling references without silently cascading", () => {
    const state = current();
    const before = structuredClone(state);
    const input = command(state, [
      { type: "remove", collection: "paths", id: id(40) },
      { type: "remove", collection: "nodes", id: id(21) }
    ]);
    expect(() => applyStoryWorkspaceCommand(state, input)).toThrow(/missing_story_edge_node/);
    expect(state).toEqual(before);
    // An explicitly repaired final graph is accepted, regardless of interim references.
    const result = applyStoryWorkspaceCommand(state, command(state, [
      ...input.operations,
      ...[id(30), id(32), id(35), id(36)].map((edgeId) => ({
        type: "remove", collection: "edges", id: edgeId
      }))
    ]));
    expect(result.workspace.graph.nodes.some((node) => node.id === id(21))).toBe(false);
    expect(result.workspace.graph.paths).toHaveLength(1);
  });

  test("rejects missing targets, invalid payloads and cyclic final flow", () => {
    const state = current();
    expect(() => applyStoryWorkspaceCommand(state, command(state, [
      { type: "remove", collection: "entities", id: id(999) }
    ]))).toThrow(/missing_story_command_target/);
    expect(() => applyStoryWorkspaceCommand(state, command(state, [
      { type: "put", collection: "nodes", value: { id: id(20) } }
    ]))).toThrow();
    expect(() => applyStoryWorkspaceCommand(state, command(state, [
      { type: "put", collection: "edges", value: {
        id: id(90), from: id(24), to: id(20), type: "sequence"
      } }
    ]))).toThrow(/cyclic_story_flow/);
  });

  test("bounds command batches and prevents identity replacement or revision overflow", () => {
    const state = current();
    const remove = { type: "remove", collection: "paths", id: id(40) };
    expect(() => applyStoryWorkspaceCommand(state, command(state, []))).toThrow(/invalid_story_command/);
    expect(() => applyStoryWorkspaceCommand(state, command(state, Array(101).fill(remove))))
      .toThrow(/invalid_story_command/);
    expect(() => applyStoryWorkspaceCommand(state, { ...command(state, [remove]), approved: true }))
      .toThrow(/invalid_story_command/);
    expect(() => applyStoryWorkspaceCommand(state, command(state, [
      { type: "replace-document", document: { ...state.workspace.document, id: id(999) } }
    ]))).toThrow(/story_command_workspace_mismatch/);
    expect(() => applyStoryWorkspaceCommand({ ...state, revision: Number.MAX_SAFE_INTEGER },
      command(state, [remove]))).toThrow(/invalid_story_workspace_revision/);
  });
});
