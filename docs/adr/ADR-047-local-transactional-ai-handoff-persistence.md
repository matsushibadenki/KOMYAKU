# ADR-047: Local Transactional AI Handoff Persistence

- Status: Accepted and implemented
- Date: 2026-08-30

## Context

AI Handoff could stream a reviewed response and create an immutable continuation Branch in memory, but an app restart discarded the result. Persisting the assistant Message separately from its Edge or consent record would create an invalid or unauditable Conversation graph. Retrying after an ambiguous storage failure must also not send the same private context to the provider again.

## Decision

The packaged Tauri app uses SQLite migration `0002_local_ai_handoffs.sql` and a fixed native command to commit the following records in one transaction:

- updated Canonical Conversation JSON;
- normalized assistant Message rows;
- normalized Conversation Edge rows;
- the completed AI Handoff, its two review hashes, consent identity and time, provider/model identity, source/result Message IDs, and provider response ID.

Only a schema-valid completed Handoff whose result is the exact `ai_continuation` child of its reviewed source may be saved. The native boundary revalidates identifiers, sizes, hashes, Message uniqueness, and Edge references before opening the transaction.

Replaying the same Handoff ID with the same result is idempotent. Reusing a Message or Handoff ID with different content is a conflict and rolls back the entire transaction. A UI storage failure retains the completed Branch in memory and exposes a save-only retry; it never invokes the provider again.

The Browser development preview remains memory-only and has no Local Storage or Session Storage fallback. A saved graph is restored when the same Conversation ID is loaded again. The packaged app enumerates at most 100 recent local records using metadata-only summaries; it loads and validates full Canonical JSON only after an explicit Open action.

## Consequences

- A completed local continuation cannot leave only a Message, only an Edge, or only an audit record.
- Provider credentials and raw API keys never enter these tables.
- Canonical JSON supplies lossless restoration while normalized rows preserve queryable identities and conflict checks.
- Existing immutable Message and Handoff IDs cannot silently acquire new meanings.
- The Local Conversation library provides startup discovery without transferring all stored conversation bodies.
- Packaged restart recovery still requires release QA on each supported operating system.
- Cloud AI Handoff persistence remains a separate transaction and authorization boundary.

## Rejected alternatives

- Browser Web Storage fallback: exposes private conversation content to a broader and less controlled storage boundary.
- Saving the Message before the Handoff: permits partial graphs after interruption.
- Retrying the provider request after a database error: can duplicate disclosure, cost, and Branches.
- Overwriting conflicting IDs: destroys auditability.
