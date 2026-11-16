ALTER TABLE reports ADD COLUMN IF NOT EXISTS request_id text;
UPDATE reports SET request_id=id WHERE request_id IS NULL;
ALTER TABLE reports ALTER COLUMN request_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS report_request_identity ON reports(signer_fingerprint,request_id);

CREATE TABLE IF NOT EXISTS health_snapshots (
  id text PRIMARY KEY, asset_id text NOT NULL, measured_at timestamptz NOT NULL,
  source_hash text NOT NULL, body jsonb NOT NULL,
  signer_msp text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS health_snapshot_latest ON health_snapshots(asset_id,measured_at DESC);
