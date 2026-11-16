ALTER TABLE security_logs ADD COLUMN IF NOT EXISTS signature_version integer NOT NULL DEFAULT 1;
ALTER TABLE security_logs ADD COLUMN IF NOT EXISTS audit_batch_id text;

CREATE TABLE IF NOT EXISTS audit_batches (
  id text PRIMARY KEY, first_log_id bigint NOT NULL, last_log_id bigint NOT NULL,
  count integer NOT NULL, digest text NOT NULL, tx_id text,
  row_ids jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON schema_migrations,transaction_requests,ledger_events,index_cursors,asset_index,state_index,
  reports,report_grants,measurements,import_receipts,risk_results,policy_previews,health_snapshots,security_logs,audit_batches FROM trustguard_broker;
GRANT SELECT(id,asset_id,owner_msp) ON reports TO trustguard_broker;
GRANT SELECT ON report_grants TO trustguard_broker;
DO $$
BEGIN
  EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I REVOKE SELECT ON TABLES FROM trustguard_broker',current_schema());
END $$;
