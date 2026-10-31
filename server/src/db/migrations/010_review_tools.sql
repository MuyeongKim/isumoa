CREATE TABLE certificate_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  certificate_id INTEGER NOT NULL REFERENCES certificates(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('recognition','rules','local_llm')),
  input_hash TEXT NOT NULL,
  rule_version TEXT NOT NULL,
  model TEXT,
  result_json TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX certificate_reviews_lookup ON certificate_reviews(certificate_id,kind,id DESC);
