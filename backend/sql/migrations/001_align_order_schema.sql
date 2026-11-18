-- ---------------------------------------------------------------------------
-- Migration 001: Align the live `orders` table with the schema the code expects.
--
-- The code (Cart.js order creation, payment.js, /api/payment/verify, billing,
-- reports, invoice) reads/writes `total_amount`, `payment_status`,
-- `customer_name`, `gst`, `razorpay_order_id` and `razorpay_payment_id`.
--
-- The baseline `schema.sql` in this repo already defines these columns. This
-- migration brings an existing database up to date so it matches the canonical
-- schema without requiring a destructive rebuild.
--
-- Idempotent (safe to run more than once).
-- --------------------------------------------------------------------------
USE oms;

DROP PROCEDURE IF EXISTS add_column_if_missing;

DELIMITER //

CREATE PROCEDURE add_column_if_missing(
  IN p_table VARCHAR(64),
  IN p_column VARCHAR(64),
  IN p_definition TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = p_table
      AND COLUMN_NAME = p_column
  ) THEN
    SET @ddl = CONCAT('ALTER TABLE `', p_table, '` ADD COLUMN `', p_column,
                      '` ', p_definition);
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END//

DELIMITER ;

-- gst: tax component recorded against the order (set by Cart.js).
CALL add_column_if_missing('orders', 'gst',
  'DECIMAL(10,2) DEFAULT 0 AFTER total_amount');

-- razorpay_order_id: written by /api/payment/create-order.
CALL add_column_if_missing('orders', 'razorpay_order_id',
  'VARCHAR(100) NULL AFTER payment_status');

-- razorpay_payment_id: written by /api/payment/verify.
CALL add_column_if_missing('orders', 'razorpay_payment_id',
  'VARCHAR(100) NULL AFTER razorpay_order_id');

-- Clean up helper procedure.
DROP PROCEDURE IF EXISTS add_column_if_missing;

-- payment_status: normalize to an enum consistent with the app's values.
-- Existing rows keep whatever value they already have (pending/paid).
ALTER TABLE orders
  MODIFY COLUMN payment_status ENUM('pending','paid') NOT NULL DEFAULT 'pending';
