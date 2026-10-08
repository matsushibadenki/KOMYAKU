# Shared Story Workspace adapter

The File menu exports Canonical Story Workspace v1 as JSON. The normative contract is `packages/story-graph` schema v1, not a promise of Desktop native API compatibility. One Canonical Document contains outline headings and scene blockquote wrappers. Each Scene references its wrapper with `documentRefs`; original Canonical root IDs and block IDs are preserved. Native graph/layout metadata contains no Canonical prose. The `komyaku.scene.document` extension retains original per-scene root attributes and metadata. The `komyaku.storygraph.native-v1` graph extension retains the app representation needed for lossless reconstruction.

Import through the snapshot/shared Workspace menu accepts this adapter representation and reconstructs a separate native work. It checks exact re-projection, Unicode/ID preservation and native domain invariants, limits the envelope to 24 MiB and Canonical strings to 10 Mi UTF-16 units, and rejects graph or document features it cannot preserve. General shared Workspace imports without an app adapter are not yet supported. This is an interoperability bridge; native persistence still uses the existing Scene properties. The authoritative composite persistence migration remains unfinished.

`test/fixtures/shared-workspace-v1.json` is produced by Rust and validated by the shared JS schema. Rust tests verify roundtrip, refusal of unsupported changes and import publication/source preservation. Native QA chose the shared JSON and launched a separate imported-work window with its original outline and prose.

## Declared meaning

Editing → Story consistency stores bounded author declarations in the Rust-owned Document extension `komyaku.story.narrative`: facts, ordered knowledge changes, preconditions, foreshadow setup/resolution, and knowledge assertions on a scene/path/phase. All preconditions see incoming knowledge; learn/forget effects follow in declared order. Assertions may inspect before or after. No prose is inferred or edited. The extension is covered by Undo, snapshots, journals, immutable versions and the portable app Archive.

Shared exports represent characters/facts as Entities, knowledge as initialState arrays, require as contains preconditions, learn/forget as add/remove effects, and foreshadowing as typed semantic edges. Multiple facts for one setup/resolution pair share one semantic edge with all declarations retained in its extension. The reference engine and Rust evaluator are compared across alternate paths in `test/narrative.test.js`. General state keys and effects beyond knowledge are still unfinished.

Native QA saved a named fact and a learn declaration for Ren at the memory scene, then queried the same scene before (unknown) and after (known). Dialog inputs and tabs use dedicated attributes to avoid the manuscript's event handlers. Unsaved declarations must be saved before querying; stale revisions are rejected. Removing facts removes their dependent declarations within the pending dialog and one final Undo command; deleting referenced scenes/characters or excluding asserted scenes from paths is refused until declarations are adjusted.

## General state rules

The native `komyaku.story.narrative` extension also supports explicit entities
(location, object, event, relationship, rule), JSON initial state, and scene
conditions/effects. Conditions are `equals`, `not-equals`, `contains`,
`not-contains`, `exists`, `not-exists`; effects are `set`, `unset`, `add`, `remove`.
All scene conditions inspect the incoming state; effects apply in declaration
order. Each reading path starts from initial state. Explicit JSON null remains
distinct from an absent key. Before/after assertions and queries use the same
Rust evaluator. `knowledge` is reserved for the dedicated character knowledge UI.
Values and declarations are bounded, validated with the document, and reversible
with one Undo. Shared Workspace export uses the same Entity/state rule contract;
Rust fixtures are compared against the independent JavaScript reference engine.

Impact tracing walks subsequent route scenes, foreshadow resolutions and declared
state readers, preserving the first predecessor and reason. It is a conservative
transitive dependency report, not a prediction of prose meaning.

## Shared Archive v1

“Export shared Archive” writes the core stored-ZIP KOMYAKU Archive v1 contract
(`.komyaku`). Its one Canonical Document contains the shared graph in the
`komyaku.storygraph.workspace-v1` extension. Stable documentRefs resolve inside
that same document. Character portraits remain portable native metadata; there
are no Canonical image assets in the current editor. Import through the snapshot
picker validates ZIP CRC, local/central directory agreement, exact entry set,
Canonical/graph references and lossless native reconstruction before publishing a
new work. A Rust fixture passes the core archive verifier and shared Workspace
schema. This is a current-document interchange; immutable native history stays
in `.komyaku-story`. Shared history Archive v2 and a composite authoritative
native Workspace are still separate migration work.

## Shared History Archive v2

File → Export shared history Archive writes stored ZIP format v2, checked independently with the shared Archive core verifier. Immutable native versions retain IDs, parents, branches, sequence and messages. A separate synthetic snapshot carries the current working manuscript; importing restores the original native versions without adding that synthetic version to the native history. Native reconstruction metadata is in `komyaku.storygraph.history-v1`; each snapshot includes the existing Workspace bridge. Generic archives lacking this adapter are rejected rather than silently losing unsupported content.

Limits: 32 MiB total, 12 MiB per snapshot, 512 native versions plus one working snapshot. ZIP checksums, snapshot SHA-256, exact manifest fields, UTC calendar dates, reachable branch heads, DAG ancestry and matching native metadata are validated before publication. Restore writes into a private staging directory and synchronizes each file and directory before publishing a separate work.

Native QA imported the fixture using the file dialog and displayed Working QA with Base, Main, Alternative and Merge (4 versions). Rust verifies exact snapshots and ancestry, tampered manifests and empty history; JavaScript independently verifies format v2, branches and two-parent merge.
