CREATE TABLE IF NOT EXISTS payment_request_details (
 exception_id VARCHAR(36) PRIMARY KEY,
 order_id VARCHAR(36) NOT NULL,
 contact_phone VARCHAR(20) NOT NULL,
 resolution_note TEXT,
 evidence_asset_id VARCHAR(36),
 resolution_type VARCHAR(20),
 submitted_at DATETIME(3),
 review_note TEXT,
 reviewed_at DATETIME(3),
 reviewed_by VARCHAR(36),
 UNIQUE KEY payment_request_order(order_id)
);

-- Preserve duplicate historical records; only the original customer request is active.
INSERT IGNORE INTO payment_request_details (exception_id,order_id,contact_phone)
SELECT e.id,e.order_id,COALESCE(NULLIF(u.phone,''),o.phone)
FROM payment_exceptions e JOIN orders o ON o.id=e.order_id AND e.actor_id=o.user_id
LEFT JOIN users u ON u.id=o.user_id
WHERE NOT EXISTS (
 SELECT 1 FROM payment_exceptions older
 WHERE older.order_id=e.order_id AND older.actor_id=o.user_id
 AND (older.created_at<e.created_at OR (older.created_at=e.created_at AND older.id<e.id))
);
