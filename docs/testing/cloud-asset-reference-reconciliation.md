# Cloud Asset reference reconciliation verification

Automated coverage verifies stable Canonical Node-to-Asset collection, deterministic sorting and SHA-256 digesting, duplicate Node rejection, Session-bound routing, authorization SQL, accepted-Asset validation before mutation, stale/conflicting revision handling, exact soft release, and same-revision replay.

PostgreSQL integration verification should run with `RUN_DB_INTEGRATION=1` in the isolated integration database after migration `0013_cloud_document_asset_checkpoints`. It must cover competing revisions, replay, conflicting digest rollback, empty-set release, foreign references, unaccepted Assets, revoked members, and transaction rollback.

Production topology tests must repeat concurrent checkpoints through separate API replicas. Correctness comes from PostgreSQL advisory and row locking, never load-balancer affinity.
