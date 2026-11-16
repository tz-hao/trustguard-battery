CREATE TABLE IF NOT EXISTS schema_migrations (
  version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS transaction_requests (
  actor_hash text NOT NULL,
  request_id text NOT NULL,
  payload_hash text NOT NULL,
  command jsonb NOT NULL,
  stage text NOT NULL CHECK (stage IN ('built','endorsed','submitted','committed','ledger-verified','rejected','invalid','unknown')),
  tx_id text,
  block_number numeric(30,0),
  result jsonb,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(actor_hash, request_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS transaction_requests_tx ON transaction_requests(tx_id) WHERE tx_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS ledger_events (
  channel text NOT NULL, tx_id text NOT NULL, event_index integer NOT NULL,
  block_number numeric(30,0) NOT NULL, payload jsonb NOT NULL,
  PRIMARY KEY(channel, tx_id, event_index)
);
CREATE TABLE IF NOT EXISTS index_cursors (
  channel text PRIMARY KEY, next_block numeric(30,0) NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS asset_index (
  id text PRIMARY KEY, code text NOT NULL UNIQUE, body jsonb NOT NULL,
  block_number numeric(30,0) NOT NULL, tx_id text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS state_index (
  state_key text PRIMARY KEY, body jsonb NOT NULL,
  block_number numeric(30,0) NOT NULL, tx_id text NOT NULL
);
CREATE TABLE IF NOT EXISTS reports (
  id text PRIMARY KEY, asset_id text NOT NULL, owner_msp text NOT NULL,
  plaintext_hash text NOT NULL, ciphertext_hash text NOT NULL,
  object_key text NOT NULL UNIQUE, key_reference text NOT NULL,
  nonce text NOT NULL, auth_tag text NOT NULL, version integer NOT NULL,
  source_hash text NOT NULL, source_signature text NOT NULL, signer_fingerprint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS report_grants (
  report_id text NOT NULL REFERENCES reports(id), grantee_msp text NOT NULL,
  expires_at timestamptz NOT NULL, revoked_at timestamptz,
  PRIMARY KEY(report_id, grantee_msp)
);
CREATE TABLE IF NOT EXISTS measurements (
  source_hash text NOT NULL, asset_id text NOT NULL, batch_id text NOT NULL,
  body jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(source_hash, asset_id)
);
CREATE TABLE IF NOT EXISTS import_receipts (
  actor_hash text NOT NULL, request_id text NOT NULL, payload_hash text NOT NULL,
  result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(actor_hash,request_id)
);
CREATE TABLE IF NOT EXISTS risk_results (
  id text PRIMARY KEY, request_id text NOT NULL, asset_id text NOT NULL,
  snapshot_hash text NOT NULL, policy_version bigint NOT NULL,
  body jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS policy_previews (
  id text PRIMARY KEY, actor_hash text NOT NULL, policy_hash text NOT NULL,
  base_version bigint NOT NULL, tests_hash text NOT NULL UNIQUE,
  passed boolean NOT NULL, report jsonb NOT NULL, signature text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS security_logs (
  id bigserial PRIMARY KEY, actor_hash text NOT NULL, request_id text,
  action text NOT NULL, outcome text NOT NULL, evidence_hash text NOT NULL,
  signature text NOT NULL, anchored_tx_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO schema_migrations(version) VALUES (1) ON CONFLICT DO NOTHING;
