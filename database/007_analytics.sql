CREATE TABLE IF NOT EXISTS analytics_events (
 id VARCHAR(36) PRIMARY KEY, session_id VARCHAR(36) NOT NULL, user_id VARCHAR(36),
 event_name VARCHAR(24) NOT NULL, product_id VARCHAR(36), chef_id VARCHAR(36), meal_id VARCHAR(20) NOT NULL DEFAULT '',
 region VARCHAR(20) NOT NULL DEFAULT '', area VARCHAR(150) NOT NULL DEFAULT '', result_count INT,
 source VARCHAR(100) NOT NULL DEFAULT '', order_id VARCHAR(36), created_at DATETIME(3) NOT NULL,
 INDEX analytics_time(event_name,created_at), INDEX analytics_session(session_id,created_at),
 INDEX analytics_product(product_id,event_name,created_at), INDEX analytics_region(region,meal_id,created_at),
 UNIQUE KEY analytics_order(order_id,event_name)
);
CREATE TABLE IF NOT EXISTS analytics_order_context (
 order_id VARCHAR(36) PRIMARY KEY, session_id VARCHAR(36), source VARCHAR(100) NOT NULL DEFAULT '',
 campaign_id VARCHAR(36), campaign_name VARCHAR(150), sale_discount INT NOT NULL DEFAULT 0,
 funding VARCHAR(20) NOT NULL DEFAULT 'chef', created_at DATETIME(3) NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_goals (
 id VARCHAR(36) PRIMARY KEY, title VARCHAR(150) NOT NULL, metric VARCHAR(24) NOT NULL,
 baseline DOUBLE NOT NULL, target DOUBLE NOT NULL, from_date DATE NOT NULL, to_date DATE NOT NULL,
 region VARCHAR(20) NOT NULL DEFAULT '', meal_id VARCHAR(20) NOT NULL DEFAULT '',
 created_by VARCHAR(36) NOT NULL, created_at DATETIME(3) NOT NULL
);
CREATE TABLE IF NOT EXISTS growth_costs (
 id VARCHAR(36) PRIMARY KEY, title VARCHAR(150) NOT NULL, kind VARCHAR(20) NOT NULL,
 amount BIGINT NOT NULL, spent_on DATE NOT NULL, source VARCHAR(100) NOT NULL DEFAULT '',
 region VARCHAR(20) NOT NULL DEFAULT '', meal_id VARCHAR(20) NOT NULL DEFAULT '',
 created_by VARCHAR(36) NOT NULL, created_at DATETIME(3) NOT NULL,
 INDEX costs_date(spent_on,kind)
);
