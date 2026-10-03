CREATE TABLE IF NOT EXISTS broadcast_jobs (
 id VARCHAR(36) PRIMARY KEY, audience VARCHAR(20) NOT NULL, category VARCHAR(20) NOT NULL,
 title VARCHAR(150) NOT NULL, body TEXT NOT NULL, href VARCHAR(255) NOT NULL,
 cursor_id VARCHAR(36) NOT NULL DEFAULT '', done BOOLEAN NOT NULL DEFAULT FALSE,
 created_at DATETIME(3) NOT NULL, INDEX broadcast_pending(done,created_at)
);
CREATE TABLE IF NOT EXISTS outbox_receipts (
 service_id VARCHAR(36) NOT NULL, event_id VARCHAR(36) NOT NULL, created_at DATETIME(3) NOT NULL,
 PRIMARY KEY(service_id,event_id), INDEX receipts_time(created_at)
);
