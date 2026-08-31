# Asset retention safety verification

Automated tests require the SQL claim to contain all three relational gates: no active references, active preservation evidence, and no active holds. Claimed logical Assets must carry `retentionGateVerified: true`; the maintenance service retries rather than deletes any candidate without it. Orphan claims must remain disabled.

Service tests cover typed evidence, SHA-256 validation, evidence invalidation, published/legal hold placement and release, required operator reason, and metadata-only audits.

Isolated PostgreSQL tests should cover concurrent hold placement versus purge claim, evidence invalidation versus claim, reactivated references, transaction rollback, multiple evidence records, last-evidence invalidation, released holds, and revoked evidence. Object Storage failure tests must confirm retry without provider error persistence.
