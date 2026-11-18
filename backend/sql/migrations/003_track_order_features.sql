-- ---------------------------------------------------------------------------
-- Migration 003: Order tracking, low-stock alerts & password reset support.
--
-- 1. Extends `orders.status` with `processing` and `cancelled` so the order
--    lifecycle becomes: pending -> processing -> shipped -> delivered, with
--    `cancelled` (and legacy `confirmed`) supported for existing data.
-- 2. `order_status_history` records every status change (who/when/note) so we
--    can render a visual timeline.
-- 3. `settings` key/value store is used for the configurable low-stock
--    threshold (key 'low_stock_threshold').
-- 4. `password_resets` stores hashed OTP tokens for the forgot/reset flow.
--
-- Idempotent (safe to run more than once).
-- --------------------------------------------------------------------------
USE oms;

-- ---------------------------------------------------------------------------
-- orders.status: widen the enum, keep existing values intact.
-- ---------------------------------------------------------------------------
ALTER TABLE orders
  MODIFY COLUMN status ENUM('pending','processing','confirmed','shipped','delivered','cancelled')
  NOT NULL DEFAULT 'pending';

-- ---------------------------------------------------------------------------
-- Helper: create a table only if it does not exist already.
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS create_table_if_missing;

DELIMITER //

CREATE PROCEDURE create_table_if_missing(
  IN p_table VARCHAR(64),
  IN p_create_sql TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = p_table
  ) THEN
    SET @ddl = p_create_sql;
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END//

DELIMITER ;

-- ---------------------------------------------------------------------------
-- order_status_history: timeline of status transitions for an order.
-- ---------------------------------------------------------------------------
CALL create_table_if_missing('order_status_history', '
  CREATE TABLE order_status_history (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_id INT NOT NULL,
    status VARCHAR(30) NOT NULL,
    note VARCHAR(255) DEFAULT NULL,
    changed_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    KEY idx_osh_order (order_id),
    CONSTRAINT fk_osh_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    CONSTRAINT fk_osh_user FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
');

-- ---------------------------------------------------------------------------
-- settings: simple key/value store (configurable low-stock threshold).
-- ---------------------------------------------------------------------------
CALL create_table_if_missing('settings', '
  CREATE TABLE settings (
    skey VARCHAR(50) PRIMARY KEY,
    svalue VARCHAR(255) NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
');

-- Seed the default low-stock threshold if not present (keeps existing data).
INSERT INTO settings (skey, svalue)
SELECT 'low_stock_threshold', '5'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM settings WHERE skey = 'low_stock_threshold');

-- ---------------------------------------------------------------------------
-- password_resets: hashed OTP tokens used by forgot/reset password flow.
-- ---------------------------------------------------------------------------
CALL create_table_if_missing('password_resets', '
  CREATE TABLE password_resets (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(100) NOT NULL,
    otp_hash VARCHAR(255) NOT NULL,
    expires_at DATETIME NOT NULL,
    is_used TINYINT(1) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    KEY idx_pr_email (email)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
');

-- Clean up helper procedure.
DROP PROCEDURE IF EXISTS create_table_if_missing;
