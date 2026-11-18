-- ---------------------------------------------------------------------------
-- Migration 007: DMS Intelligence - Phases 6-10.
--
--  Phase 6  Notifications & Activity/Audit Logs
--  Phase 7  (Analytics uses existing tables; no schema needed here)
--  Phase 8  Smart Reorder (adds reorder columns to products)
--  Phase 9  (Global Search uses existing tables)
--  Phase 10 (UI polish - no schema)
--
-- Also includes supporting finance/logistics tables used by downstream phases:
--  retailer_credit_transactions, collections, deliveries
--
-- All changes are additive / non-destructive. Existing data preserved.
-- Idempotent (safe to re-run). MySQL 8.0.
-- ---------------------------------------------------------------------------
USE oms;

-- ---------------------------------------------------------------------------
-- Helpers
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

DROP PROCEDURE IF EXISTS create_table_if_missing;
DELIMITER //
CREATE PROCEDURE create_table_if_missing(
  IN p_table VARCHAR(64),
  IN p_create_sql TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table
  ) THEN
    SET @ddl = p_create_sql;
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END//
DELIMITER ;

-- ===========================================================================
-- PHASE 6 - NOTIFICATIONS
-- ===========================================================================
CALL create_table_if_missing('notifications', '
  CREATE TABLE notifications (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    title VARCHAR(150) NOT NULL,
    message VARCHAR(255) NOT NULL,
    type ENUM("low_stock","order","payment","delivery","expiry","return","credit","collection","system") NOT NULL DEFAULT "system",
    is_read TINYINT(1) NOT NULL DEFAULT 0,
    reference_type VARCHAR(50) DEFAULT NULL,
    reference_id INT DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    KEY idx_notif_user (user_id, is_read),
    KEY idx_notif_created (created_at),
    KEY idx_notif_type (type),
    CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
');

-- ===========================================================================
-- PHASE 6 - ACTIVITY / AUDIT LOGS
-- ===========================================================================
CALL create_table_if_missing('activity_logs', '
  CREATE TABLE activity_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT DEFAULT NULL,
    action VARCHAR(50) NOT NULL,
    module VARCHAR(50) NOT NULL,
    description VARCHAR(255) DEFAULT NULL,
    reference_type VARCHAR(50) DEFAULT NULL,
    reference_id INT DEFAULT NULL,
    ip_address VARCHAR(45) DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    KEY idx_act_user (user_id),
    KEY idx_act_module (module),
    KEY idx_act_action (action),
    KEY idx_act_created (created_at),
    CONSTRAINT fk_act_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
');

-- ===========================================================================
-- RETAILER CREDIT TRANSACTIONS (Phase 6 downstream / finance)
-- ===========================================================================
CALL create_table_if_missing('retailer_credit_transactions', '
  CREATE TABLE retailer_credit_transactions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    retailer_id INT NOT NULL,
    order_id INT DEFAULT NULL,
    transaction_type ENUM("CREDIT","PAYMENT","ADJUSTMENT","REFUND") NOT NULL,
    amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    balance_after DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    due_date DATE DEFAULT NULL,
    notes VARCHAR(255) DEFAULT NULL,
    created_by INT DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    KEY idx_credit_retailer (retailer_id),
    KEY idx_credit_order (order_id),
    KEY idx_credit_due (due_date),
    KEY idx_credit_type (transaction_type),
    CONSTRAINT fk_credit_retailer FOREIGN KEY (retailer_id) REFERENCES retailers(id) ON DELETE CASCADE,
    CONSTRAINT fk_credit_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL,
    CONSTRAINT fk_credit_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
');

-- ===========================================================================
-- COLLECTIONS (finance)
-- ===========================================================================
CALL create_table_if_missing('collections', '
  CREATE TABLE collections (
    id INT AUTO_INCREMENT PRIMARY KEY,
    collection_number VARCHAR(50) NOT NULL,
    retailer_id INT NOT NULL,
    amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    payment_method ENUM("cash","upi","bank_transfer","cheque","razorpay") NOT NULL DEFAULT "cash",
    reference_number VARCHAR(100) DEFAULT NULL,
    collection_date DATE DEFAULT NULL,
    notes VARCHAR(255) DEFAULT NULL,
    collected_by INT DEFAULT NULL,
    status ENUM("completed","pending","bounced") NOT NULL DEFAULT "completed",
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_collection_number (collection_number),
    KEY idx_col_retailer (retailer_id),
    KEY idx_col_date (collection_date),
    KEY idx_col_by (collected_by),
    KEY idx_col_method (payment_method),
    CONSTRAINT fk_col_retailer FOREIGN KEY (retailer_id) REFERENCES retailers(id) ON DELETE CASCADE,
    CONSTRAINT fk_col_user FOREIGN KEY (collected_by) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
');

-- ===========================================================================
-- DELIVERIES (logistics)
-- ===========================================================================
CALL create_table_if_missing('deliveries', '
  CREATE TABLE deliveries (
    id INT AUTO_INCREMENT PRIMARY KEY,
    delivery_number VARCHAR(50) NOT NULL,
    order_id INT NOT NULL,
    delivery_person VARCHAR(150) DEFAULT NULL,
    delivery_phone VARCHAR(30) DEFAULT NULL,
    vehicle_number VARCHAR(30) DEFAULT NULL,
    dispatch_date DATE DEFAULT NULL,
    expected_delivery DATE DEFAULT NULL,
    delivered_date DATE DEFAULT NULL,
    delivery_status ENUM("ready","dispatched","out_for_delivery","delivered","failed") NOT NULL DEFAULT "ready",
    delivery_address VARCHAR(255) DEFAULT NULL,
    notes VARCHAR(255) DEFAULT NULL,
    created_by INT DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_delivery_number (delivery_number),
    KEY idx_del_order (order_id),
    KEY idx_del_status (delivery_status),
    KEY idx_del_dispatch (dispatch_date),
    CONSTRAINT fk_del_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    CONSTRAINT fk_del_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
');

-- ===========================================================================
-- PHASE 8 - SMART REORDER (additive product columns)
-- ===========================================================================
CALL add_column_if_missing('products', 'reorder_level',    "int NOT NULL DEFAULT 0 AFTER min_stock_level");
CALL add_column_if_missing('products', 'reorder_quantity', "int NOT NULL DEFAULT 0 AFTER reorder_level");

-- ---------------------------------------------------------------------------
-- Cleanup helpers
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS add_column_if_missing;
DROP PROCEDURE IF EXISTS create_table_if_missing;
