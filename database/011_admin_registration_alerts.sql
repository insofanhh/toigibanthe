CREATE TABLE IF NOT EXISTS admin_registration_alerts (
 id VARCHAR(36) PRIMARY KEY,
 admin_id VARCHAR(36) NOT NULL,
 user_id VARCHAR(36) NOT NULL,
 created_at DATETIME(3) NOT NULL,
 seen_at DATETIME(3) NULL,
 UNIQUE KEY admin_registration_user (admin_id,user_id),
 INDEX admin_registration_unseen (admin_id,seen_at,created_at)
);
