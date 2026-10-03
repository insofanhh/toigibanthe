CREATE TABLE IF NOT EXISTS users (
 id VARCHAR(36) PRIMARY KEY, name VARCHAR(100) NOT NULL, email VARCHAR(190) NOT NULL UNIQUE,
 password_hash VARCHAR(255) NOT NULL, phone VARCHAR(30) NOT NULL DEFAULT '', role VARCHAR(12) NOT NULL DEFAULT 'user',
 active BOOLEAN NOT NULL DEFAULT TRUE, avatar_url TEXT, created_at DATETIME(3) NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash VARCHAR(64) PRIMARY KEY, user_id VARCHAR(36) NOT NULL, expires_at DATETIME(3) NOT NULL,
 INDEX sessions_user (user_id), INDEX sessions_expiry (expires_at)
);
CREATE TABLE IF NOT EXISTS chefs (
 id VARCHAR(36) PRIMARY KEY, user_id VARCHAR(36) NOT NULL UNIQUE, name VARCHAR(100) NOT NULL,
 bio TEXT NOT NULL, address TEXT NOT NULL, area VARCHAR(150) NOT NULL,
 lat DOUBLE NOT NULL, lng DOUBLE NOT NULL, radius_km DOUBLE NOT NULL DEFAULT 5,
 status VARCHAR(20) NOT NULL DEFAULT 'pending', rejection_reason TEXT,
 avatar_url TEXT, cover_url TEXT, bank_bin VARCHAR(6), bank_name VARCHAR(100), account_no VARCHAR(30), account_name VARCHAR(100),
 rating DOUBLE NOT NULL DEFAULT 0, rating_count INT NOT NULL DEFAULT 0, completed_orders INT NOT NULL DEFAULT 0,
 created_at DATETIME(3) NOT NULL, INDEX chefs_location (lat,lng), INDEX chefs_status (status)
);
CREATE TABLE IF NOT EXISTS products (
 id VARCHAR(36) PRIMARY KEY, chef_id VARCHAR(36) NOT NULL, name VARCHAR(150) NOT NULL,
 description TEXT NOT NULL, ingredients TEXT, price INT NOT NULL, image_url TEXT NOT NULL,
 prep_minutes INT NOT NULL DEFAULT 25, active BOOLEAN NOT NULL DEFAULT TRUE,
 rating DOUBLE NOT NULL DEFAULT 0, rating_count INT NOT NULL DEFAULT 0, created_at DATETIME(3) NOT NULL,
 INDEX products_chef (chef_id,active)
);
CREATE TABLE IF NOT EXISTS meal_settings (
 id VARCHAR(20) PRIMARY KEY, name VARCHAR(40) NOT NULL, cutoff_time VARCHAR(5) NOT NULL,
 day_offset INT NOT NULL DEFAULT 0, sort_order INT NOT NULL
);
CREATE TABLE IF NOT EXISTS kitchen_sessions (
 id VARCHAR(36) PRIMARY KEY, chef_id VARCHAR(36) NOT NULL, service_date DATE NOT NULL,
 is_open BOOLEAN NOT NULL DEFAULT FALSE, created_at DATETIME(3) NOT NULL,
 UNIQUE KEY kitchen_day (chef_id,service_date)
);
CREATE TABLE IF NOT EXISTS daily_menu (
 id VARCHAR(36) PRIMARY KEY, session_id VARCHAR(36) NOT NULL, product_id VARCHAR(36) NOT NULL,
 meal_id VARCHAR(20) NOT NULL, cutoff_at DATETIME(3) NOT NULL, stock INT NOT NULL,
 sale_price INT, campaign_id VARCHAR(36), enabled BOOLEAN NOT NULL DEFAULT TRUE,
 UNIQUE KEY menu_product (session_id,product_id,meal_id), INDEX menu_meal (meal_id,cutoff_at)
);
CREATE TABLE IF NOT EXISTS campaigns (
 id VARCHAR(36) PRIMARY KEY, name VARCHAR(150) NOT NULL, active BOOLEAN NOT NULL DEFAULT FALSE,
 starts_at DATETIME(3) NOT NULL, ends_at DATETIME(3) NOT NULL, created_at DATETIME(3) NOT NULL
);
CREATE TABLE IF NOT EXISTS banners (
 id VARCHAR(36) PRIMARY KEY, title VARCHAR(150) NOT NULL, body TEXT NOT NULL, image_url TEXT,
 href VARCHAR(255) NOT NULL DEFAULT '/nearby', active BOOLEAN NOT NULL DEFAULT TRUE, sort_order INT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS addresses (
 id VARCHAR(36) PRIMARY KEY, user_id VARCHAR(36) NOT NULL, label VARCHAR(50) NOT NULL,
 address TEXT NOT NULL, lat DOUBLE NOT NULL, lng DOUBLE NOT NULL, recipient VARCHAR(100) NOT NULL,
 phone VARCHAR(30) NOT NULL, is_default BOOLEAN NOT NULL DEFAULT FALSE, INDEX addresses_user (user_id)
);
CREATE TABLE IF NOT EXISTS favorites (
 user_id VARCHAR(36) NOT NULL, product_id VARCHAR(36) NOT NULL, created_at DATETIME(3) NOT NULL,
 PRIMARY KEY(user_id,product_id)
);
CREATE TABLE IF NOT EXISTS orders (
 id VARCHAR(36) PRIMARY KEY, code VARCHAR(20) NOT NULL UNIQUE, user_id VARCHAR(36) NOT NULL,
 chef_id VARCHAR(36) NOT NULL, meal_id VARCHAR(20) NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'PLACED',
 payment_status VARCHAR(24) NOT NULL DEFAULT 'PENDING', payment_reported BOOLEAN NOT NULL DEFAULT FALSE,
 subtotal INT NOT NULL, discount INT NOT NULL DEFAULT 0, delivery_fee INT NOT NULL, total INT NOT NULL,
 recipient VARCHAR(100) NOT NULL, phone VARCHAR(30) NOT NULL, address TEXT NOT NULL, lat DOUBLE NOT NULL, lng DOUBLE NOT NULL,
 chef_lat DOUBLE NOT NULL, chef_lng DOUBLE NOT NULL, distance_km DOUBLE NOT NULL,
 route_distance_km DOUBLE, route_duration_seconds INT, route_polyline MEDIUMTEXT,
 bank_bin VARCHAR(6) NOT NULL, bank_name VARCHAR(100) NOT NULL, account_no VARCHAR(30) NOT NULL, account_name VARCHAR(100) NOT NULL,
 transfer_content VARCHAR(25) NOT NULL UNIQUE, qr_data MEDIUMTEXT, note TEXT, cancellation_reason TEXT,
 idempotency_key VARCHAR(100) NOT NULL, voucher_id VARCHAR(36), expires_at DATETIME(3) NOT NULL,
 payment_confirmed_at DATETIME(3), created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL,
 UNIQUE KEY order_retry(user_id,idempotency_key), INDEX orders_user(user_id,created_at), INDEX orders_chef(chef_id,status), INDEX orders_expiry(status,expires_at)
);
CREATE TABLE IF NOT EXISTS order_items (
 id VARCHAR(36) PRIMARY KEY, order_id VARCHAR(36) NOT NULL, menu_id VARCHAR(36) NOT NULL,
 product_id VARCHAR(36) NOT NULL, name VARCHAR(150) NOT NULL, image_url TEXT NOT NULL,
 unit_price INT NOT NULL, quantity INT NOT NULL, INDEX order_items_order(order_id)
);
CREATE TABLE IF NOT EXISTS order_events (
 id VARCHAR(36) PRIMARY KEY, order_id VARCHAR(36) NOT NULL, actor_id VARCHAR(36) NOT NULL,
 status VARCHAR(30) NOT NULL, note TEXT, created_at DATETIME(3) NOT NULL, INDEX events_order(order_id,created_at)
);
CREATE TABLE IF NOT EXISTS notifications (
 id VARCHAR(36) PRIMARY KEY, user_id VARCHAR(36) NOT NULL, category VARCHAR(20) NOT NULL,
 title VARCHAR(150) NOT NULL, body TEXT NOT NULL, href VARCHAR(255) NOT NULL,
 is_read BOOLEAN NOT NULL DEFAULT FALSE, created_at DATETIME(3) NOT NULL, INDEX notifications_user(user_id,created_at)
);
CREATE TABLE IF NOT EXISTS realtime_outbox (
 id VARCHAR(36) PRIMARY KEY, user_id VARCHAR(36) NOT NULL, payload JSON NOT NULL,
 created_at DATETIME(3) NOT NULL, published_at DATETIME(3), INDEX outbox_pending(published_at,created_at)
);
CREATE TABLE IF NOT EXISTS vouchers (
 id VARCHAR(36) PRIMARY KEY, code VARCHAR(30) NOT NULL UNIQUE, title VARCHAR(150) NOT NULL,
 chef_id VARCHAR(36) NOT NULL, discount_amount INT NOT NULL, min_subtotal INT NOT NULL DEFAULT 0,
 max_uses INT NOT NULL, used_count INT NOT NULL DEFAULT 0, expires_at DATETIME(3) NOT NULL, active BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE IF NOT EXISTS voucher_redemptions (
 voucher_id VARCHAR(36) NOT NULL, user_id VARCHAR(36) NOT NULL, order_id VARCHAR(36) NOT NULL,
 PRIMARY KEY(voucher_id,user_id), UNIQUE KEY voucher_order(order_id)
);
CREATE TABLE IF NOT EXISTS reviews (
 id VARCHAR(36) PRIMARY KEY, order_id VARCHAR(36) NOT NULL UNIQUE, user_id VARCHAR(36) NOT NULL,
 chef_id VARCHAR(36) NOT NULL, rating INT NOT NULL, body TEXT NOT NULL, created_at DATETIME(3) NOT NULL,
 INDEX reviews_chef(chef_id)
);
CREATE TABLE IF NOT EXISTS assets (
 id VARCHAR(36) PRIMARY KEY, user_id VARCHAR(36) NOT NULL, kind VARCHAR(20) NOT NULL,
 url TEXT NOT NULL, pathname TEXT NOT NULL, content_type VARCHAR(100) NOT NULL, original_name VARCHAR(255) NOT NULL,
 created_at DATETIME(3) NOT NULL, INDEX assets_owner(user_id,kind)
);
CREATE TABLE IF NOT EXISTS audit_logs (
 id VARCHAR(36) PRIMARY KEY, actor_id VARCHAR(36) NOT NULL, action VARCHAR(100) NOT NULL,
 entity_id VARCHAR(36), detail JSON, created_at DATETIME(3) NOT NULL
);
CREATE TABLE IF NOT EXISTS platform_settings (
 id VARCHAR(50) PRIMARY KEY, value JSON NOT NULL
);
CREATE TABLE IF NOT EXISTS payment_exceptions (
 id VARCHAR(36) PRIMARY KEY, order_id VARCHAR(36) NOT NULL, actor_id VARCHAR(36) NOT NULL,
 kind VARCHAR(30) NOT NULL, amount INT NOT NULL, note TEXT NOT NULL,
 status VARCHAR(20) NOT NULL DEFAULT 'OPEN', created_at DATETIME(3) NOT NULL
);
