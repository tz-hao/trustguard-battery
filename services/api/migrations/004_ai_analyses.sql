CREATE TABLE ai_analyses (
  actor_hash text NOT NULL,
  request_id text NOT NULL,
  asset_id text NOT NULL,
  payload_hash text NOT NULL,
  state text NOT NULL CHECK (state IN ('running','completed','failed')),
  result jsonb,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  PRIMARY KEY (actor_hash, request_id)
);
CREATE INDEX ai_analyses_recent ON ai_analyses(created_at) WHERE state='running';
-- Contains advisory output, never credentials, raw prompts or decrypted reports.
-- Default PostgreSQL table privileges grant no access to the restricted key broker.