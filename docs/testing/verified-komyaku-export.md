# Verified `.komyaku` export testing

Coverage includes deterministic ZIP writing, strict store-only reading, CRC32, unsafe/duplicate paths, archive and entry budgets, Canonical identity, exact Asset-set equality, Asset SHA-256, corruption, immutable write, persisted reread, second full verification, metadata conflict, unavailable Assets, authorization, and evidence registration only after successful reread.

Conformance fixtures live under `docs/formats/fixtures`. Format changes must update the normative specification, machine-readable schema, fixtures, writer, reader, and round-trip tests together.
