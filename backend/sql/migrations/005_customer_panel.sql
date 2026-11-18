-- ---------------------------------------------------------------------------
-- Migration 005: Customer Panel.
--
-- Adds customer-profile columns to `users` and shipping/delivery columns to
-- `orders`. All changes are additive / non-destructive so existing data is
-- preserved. Idempotent (safe to run more than once). MySQL 8.0.29+.
-- ---------------------------------------------------------------------------
USE oms;

-- ---------------------------------------------------------------------------
-- Helper: add a column only if it does not exist yet.
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS add_column_if_missing;
DELIMITER //
CREATE PROCEDURE add_column_if_missing(
  IN p_table VARCHAR(64),
  IN p_column VARCHAR(64),
  IN p_definition TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = p_table
      AND COLUMN_NAME = p_column
  ) THEN
    SET @ddl = CONCAT('ALTER TABLE `', p_table, '` ADD COLUMN `', p_column, '` ', p_definition);
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END//
DELIMITER ;

-- ---------------------------------------------------------------------------
-- users: customer profile fields + optional retailer mapping
-- ---------------------------------------------------------------------------
CALL add_column_if_missing('users', 'mobile',           "varchar(20) DEFAULT NULL");
CALL add_column_if_missing('users', 'address',          "varchar(255) DEFAULT NULL");
CALL add_column_if_missing('users', 'city',             "varchar(100) DEFAULT NULL");
CALL add_column_if_missing('users', 'state',            "varchar(100) DEFAULT NULL");
CALL add_column_if_missing('users', 'pincode',          "varchar(20) DEFAULT NULL");
CALL add_column_if_missing('users', 'retailer_id',      "int DEFAULT NULL");

-- ---------------------------------------------------------------------------
-- orders: shipping / delivery information + payment method
-- ---------------------------------------------------------------------------
CALL add_column_if_missing('orders', 'shipping_name',    "varchar(150) DEFAULT NULL");
CALL add_column_if_missing('orders', 'shipping_mobile',  "varchar(20) DEFAULT NULL");
CALL add_column_if_missing('orders', 'shipping_address', "varchar(255) DEFAULT NULL");
CALL add_column_if_missing('orders', 'shipping_city',    "varchar(100) DEFAULT NULL");
CALL add_column_if_missing('orders', 'shipping_state',   "varchar(100) DEFAULT NULL");
CALL add_column_if_missing('orders', 'shipping_pincode', "varchar(20) DEFAULT NULL");
CALL add_column_if_missing('orders', 'payment_method',   "varchar(50) DEFAULT 'cash'");

DROP PROCEDURE IF EXISTS add_column_if_missing;
