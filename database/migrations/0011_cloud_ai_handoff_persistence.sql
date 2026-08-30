BEGIN;

ALTER TABLE ai_handoffs
    ADD COLUMN outbound_payload_hash text;

UPDATE ai_handoffs
SET outbound_payload_hash = payload_hash
WHERE outbound_payload_hash IS NULL;

ALTER TABLE ai_handoffs
    ALTER COLUMN outbound_payload_hash SET NOT NULL;

ALTER TABLE ai_handoffs
    ADD CONSTRAINT ai_handoffs_outbound_payload_hash_check
    CHECK (outbound_payload_hash ~ '^[0-9a-f]{64}$');

CREATE INDEX ai_handoffs_conversation_completed_idx
    ON ai_handoffs (conversation_id, completed_at DESC)
    WHERE handoff_status = 'completed';

INSERT INTO schema_migrations (version)
VALUES ('0011_cloud_ai_handoff_persistence')
ON CONFLICT (version) DO NOTHING;

COMMIT;
