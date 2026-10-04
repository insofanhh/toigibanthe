CREATE TABLE IF NOT EXISTS order_delivery_reminders (
  order_id VARCHAR(36) PRIMARY KEY,
  due_at DATETIME(3) NOT NULL,
  state VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  notification_id VARCHAR(36), processed_at DATETIME(3),
  INDEX delivery_reminder_due(state,due_at)
);
