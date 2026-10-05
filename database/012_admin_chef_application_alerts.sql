CREATE TABLE IF NOT EXISTS admin_chef_application_alerts (
 id VARCHAR(36) PRIMARY KEY,
 admin_id VARCHAR(36) NOT NULL,
 chef_id VARCHAR(36) NOT NULL,
 submission_id VARCHAR(36) NOT NULL,
 created_at DATETIME(3) NOT NULL,
 seen_at DATETIME(3) NULL,
 UNIQUE KEY admin_chef_submission (admin_id,submission_id),
 INDEX admin_chef_application_unseen (admin_id,seen_at,created_at)
);
