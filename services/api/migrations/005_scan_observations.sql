CREATE TABLE scan_observations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code varchar(24) NOT NULL,
  site text NOT NULL,
  actor_hash text NOT NULL,
  request_id text NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  conflict_with bigint REFERENCES scan_observations(id),
  UNIQUE(actor_hash, request_id)
);
CREATE INDEX scan_code_time ON scan_observations(code, observed_at DESC);
