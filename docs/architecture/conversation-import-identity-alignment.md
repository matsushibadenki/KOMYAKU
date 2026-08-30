# Conversation Import Identity Alignment

- Status: [Done] identity derivation implemented; Desktop Cloud synchronization remains next
- Updated: 2026-08-30

## Problem

Desktop review and Cloud import intentionally parse the same provider export independently. The current adapters create fresh Canonical UUIDs during each parse. Therefore the authored content and source provenance can match while `conversation.id` and `message.id` differ between the local graph and PostgreSQL graph.

Cloud Handoff persistence correctly validates selected Message IDs against PostgreSQL. Sending Desktop IDs directly would fail closed, and weakening that check would allow a response to be attached to the wrong Branch.

## Required properties

An alignment mechanism must:

1. map every imported Conversation and Message without comparing authored text heuristically;
2. preserve provider source IDs and bundle ordinals where available;
3. handle missing, duplicate, or unstable provider IDs as an explicit partial result;
4. bind the mapping to the reviewed raw source SHA-256, parser name, and parser version;
5. never expose another Workspace's identifiers;
6. remain stable across import replay and independent Desktop／Server parsing;
7. allow locally created continuation Message IDs to be retained when first uploaded.

## Adopted direction

Identity version 1 uses UUIDv5 with a fixed KOMYAKU namespace, identity scope, source hash, parser name/version, provider identity, source Conversation identity or bundle ordinal, source Message identity, and a disambiguation ordinal. Local parsing uses scope `local`; Cloud parsing uses the target Workspace UUID. Do not derive identity from title or authored body text.

Where a provider export lacks stable node identities, the Import API should return an authenticated identity manifest bound to the Import ID and source hash. Desktop must review any partial mapping before enabling Cloud continuation synchronization.

## Gate

Synthetic fixtures now prove stable independent identities for Generic JSON, ChatGPT, Claude, structured Gemini, and flat Gemini My Activity. Desktop Cloud Handoff synchronization remains disabled until the UI reparses the reviewed exact bytes with the selected Workspace scope and selects an explicit Cloud Provider Connection. Existing Cloud Handoff API checks must not be relaxed as a workaround.
