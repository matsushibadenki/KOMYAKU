# Canonical Story Graph v1

Story Graph v1 is the machine-readable structure associated with one Canonical Document. Its implementation is `@komyaku/story-graph`; the normative schema identifier is `https://komyaku.example/schemas/story-graph/v1`.

The Graph has independent UUID identities for Graph Nodes, Entities, Edges and Paths. Content Nodes reference stable Canonical Node IDs through `documentRefs`. They never copy the referenced prose. A Story Workspace pairs exactly one Canonical Document and one Story Graph with the same `documentId`.

## Flow and meaning

`sequence`, `alternative` and `merge` edges define reading flow and must form a DAG. `reference`, `causes`, `requires`, `foreshadows`, `resolves`, `contradicts`, `supports`, `explains`, `character-state` and `timeline` express meaning; semantic cycles are allowed. A named Path lists a connected, non-repeating route through flow edges.

## Deterministic state

Entities represent `character`, `location`, `object`, `event`, `fact`, `relationship` or `rule`. Their `initialState` is bounded JSON. Story Nodes declare ordered `preconditions` and `effects`:

- conditions: `equals`, `not-equals`, `contains`, `not-contains`, `exists`, `not-exists`
- effects: `set`, `unset`, `add`, `remove`

Path evaluation checks each precondition against the state before that Node and applies effects afterward. This makes questions such as character knowledge at an exact scene reproducible. It does not infer undeclared meaning from prose.

Impact tracing follows declared reading flow, state dependencies and typed semantic relations. Its result is a conservative set of structurally affected Nodes, not proof that every referenced passage must change.

## Version boundary

`encodeStoryWorkspaceSnapshot` deterministically encodes the validated Document and Graph together without Unicode normalization. This is the intended Story Graph Version payload. Current Desktop SQLite and History Archive v2 persist Canonical Document snapshots only, so composite native persistence and a new compatible Archive contract remain required.

## Agent boundary

Agents may issue queries and return proposed state declarations or edits with provenance. The Graph Engine validates declared structure; an author must accept changes before KOMYAKU creates a Version. AI output is never an authoritative fact solely because a model produced it.


## Atomic command contract (shared reference implementation)

`applyStoryWorkspaceCommand({ revision, workspace }, command)` is a pure contract for a future Rust command handler. It does not own state, grant approval, persist data, or create a Version. WebViews must not use its returned workspace as authoritative native state.

The strict command envelope contains `documentId`, `graphId`, `expectedRevision` and 1–100 ordered `operations`, with a 24 MiB serialized request limit. Supported operations are:

- `replace-document`: replace the Canonical Document while preserving its identity.
- `put`: insert or replace one full Node, Edge, Path or Entity, selected by `collection` and the value's UUID.
- `remove`: remove an existing item by collection and UUID.

The engine checks workspace identity and revision, copies the current workspace, applies the whole batch, and validates the final Document and Graph together. Intermediate references may be incomplete when another operation repairs them in the same batch. Dangling final references, cyclic flow, invalid payloads and missing removal targets reject the entire batch. Removing a Node never silently removes related Edges, Paths or state rules; the caller must propose those changes explicitly.

A successful result returns `revision + 1` and the complete deterministic snapshot. Failed commands leave caller-owned state untouched. Replaying a successful command against its result fails the expected-revision check. This is optimistic concurrency, not durable retry idempotency: native operation IDs and transactional replay receipts remain unfinished.

The future Rust owner must validate independently, compare and advance the revision inside the same SQLite transaction as the composite write, and emit bounded projections only after commit. Agent proposals still require author review at the application boundary; the existence of a valid command is not approval.
