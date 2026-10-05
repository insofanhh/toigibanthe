CREATE TABLE IF NOT EXISTS user_account_details (
 user_id VARCHAR(36) PRIMARY KEY,
 avatar_asset_id VARCHAR(36) NULL,
 deleted_at DATETIME(3) NULL
);
