CREATE TABLE IF NOT EXISTS sepay_transaction_details (
 chef_id VARCHAR(36) NOT NULL, transaction_id VARCHAR(80) NOT NULL,
 payment_code VARCHAR(100), description TEXT, sub_account VARCHAR(100), failure_reason VARCHAR(40),
 PRIMARY KEY(chef_id,transaction_id)
);
