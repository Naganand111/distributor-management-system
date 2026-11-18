-- ---------------------------------------------------------------------------
-- Migration 006: DMS Advanced - Phases 1-5.
--
--  Phase 1  Sales & Distribution Management (sales reps, targets, commissions)
--  Phase 2  Territory Management
--  Phase 3  Purchase Management
--  Phase 4  Returns Management
--  Phase 5  Damaged & Expiry Inventory
--
-- All changes are additive / non-destructive. Idempotent (safe to re-run).
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
-- PHASE 1 - SALES & DISTRIBUTION MANAGEMENT
-- ===========================================================================

CREATE TABLE IF NOT EXISTS sales_representatives (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT DEFAULT NULL,
  employee_code VARCHAR(30) DEFAULT NULL,
  name VARCHAR(150) NOT NULL,
  email VARCHAR(100) DEFAULT NULL,
  phone VARCHAR(30) DEFAULT NULL,
  territory VARCHAR(150) DEFAULT NULL,
  territory_id INT DEFAULT NULL,
  joining_date DATE DEFAULT NULL,
  target_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  commission_percentage DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  status ENUM('active','inactive') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_sr_code (employee_code),
  KEY idx_sr_user (user_id),
  KEY idx_sr_territory (territory_id),
  CONSTRAINT fk_sr_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sales_targets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  sales_rep_id INT NOT NULL,
  territory_id INT DEFAULT NULL,
  period VARCHAR(7) NOT NULL,            -- YYYY-MM monthly period
  target_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_sr_period (sales_rep_id, period),
  KEY idx_st_rep (sales_rep_id),
  KEY idx_st_period (period),
  CONSTRAINT fk_st_rep FOREIGN KEY (sales_rep_id) REFERENCES sales_representatives(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Representative - retailer assignments
CREATE TABLE IF NOT EXISTS sales_rep_retailers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  sales_rep_id INT NOT NULL,
  retailer_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_srr (sales_rep_id, retailer_id),
  KEY idx_srr_retailer (retailer_id),
  CONSTRAINT fk_srr_rep FOREIGN KEY (sales_rep_id) REFERENCES sales_representatives(id) ON DELETE CASCADE,
  CONSTRAINT fk_srr_retailer FOREIGN KEY (retailer_id) REFERENCES retailers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sales_commissions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  sales_rep_id INT NOT NULL,
  order_id INT DEFAULT NULL,
  amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  period VARCHAR(7) DEFAULT NULL,
  status ENUM('accrued','paid') NOT NULL DEFAULT 'accrued',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_comm_rep (sales_rep_id),
  KEY idx_comm_order (order_id),
  KEY idx_comm_period (period),
  CONSTRAINT fk_comm_rep FOREIGN KEY (sales_rep_id) REFERENCES sales_representatives(id) ON DELETE CASCADE,
  CONSTRAINT fk_comm_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ===========================================================================
-- PHASE 2 - TERRITORY MANAGEMENT
-- ===========================================================================
CREATE TABLE IF NOT EXISTS territories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  code VARCHAR(30) DEFAULT NULL,
  state VARCHAR(100) DEFAULT NULL,
  district VARCHAR(100) DEFAULT NULL,
  city VARCHAR(100) DEFAULT NULL,
  description VARCHAR(255) DEFAULT NULL,
  manager_id INT DEFAULT NULL,
  status ENUM('active','inactive') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_terr_name (name),
  KEY idx_terr_manager (manager_id),
  CONSTRAINT fk_terr_manager FOREIGN KEY (manager_id) REFERENCES sales_representatives(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Link retailers to territories (additive)
CALL add_column_if_missing('retailers', 'territory_id', 'INT DEFAULT NULL AFTER state');
CALL add_column_if_missing('retailers', 'sales_rep_id', 'INT DEFAULT NULL AFTER territory_id');

-- ===========================================================================
-- PHASE 3 - PURCHASE MANAGEMENT
-- ===========================================================================
CREATE TABLE IF NOT EXISTS purchase_orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  po_number VARCHAR(50) NOT NULL,
  supplier_id INT DEFAULT NULL,
  order_date DATE DEFAULT NULL,
  expected_delivery DATE DEFAULT NULL,
  total_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  status ENUM('draft','sent','confirmed','partially_received','received','cancelled') NOT NULL DEFAULT 'draft',
  notes VARCHAR(255) DEFAULT NULL,
  created_by INT DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_po_number (po_number),
  KEY idx_po_supplier (supplier_id),
  KEY idx_po_status (status),
  CONSTRAINT fk_po_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL,
  CONSTRAINT fk_po_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  purchase_order_id INT NOT NULL,
  product_id INT NOT NULL,
  quantity INT NOT NULL,
  purchase_price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  total DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  received_qty INT NOT NULL DEFAULT 0,
  KEY idx_poi_po (purchase_order_id),
  KEY idx_poi_product (product_id),
  CONSTRAINT fk_poi_po FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_poi_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ===========================================================================
-- PHASE 4 - RETURNS MANAGEMENT
-- ===========================================================================
CREATE TABLE IF NOT EXISTS returns (
  id INT AUTO_INCREMENT PRIMARY KEY,
  return_number VARCHAR(50) NOT NULL,
  order_id INT DEFAULT NULL,
  retailer_id INT DEFAULT NULL,
  supplier_id INT DEFAULT NULL,
  return_type ENUM('customer','retailer','supplier','damaged') NOT NULL DEFAULT 'retailer',
  reason VARCHAR(255) DEFAULT NULL,
  status ENUM('requested','approved','rejected','received','refunded') NOT NULL DEFAULT 'requested',
  total_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  created_by INT DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_return_number (return_number),
  KEY idx_returns_order (order_id),
  KEY idx_returns_retailer (retailer_id),
  KEY idx_returns_status (status),
  CONSTRAINT fk_returns_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL,
  CONSTRAINT fk_returns_retailer FOREIGN KEY (retailer_id) REFERENCES retailers(id) ON DELETE SET NULL,
  CONSTRAINT fk_returns_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS return_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  return_id INT NOT NULL,
  product_id INT NOT NULL,
  quantity INT NOT NULL,
  price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  item_condition ENUM('good','damaged','expired') NOT NULL DEFAULT 'good',
  KEY idx_ri_return (return_id),
  KEY idx_ri_product (product_id),
  CONSTRAINT fk_ri_return FOREIGN KEY (return_id) REFERENCES returns(id) ON DELETE CASCADE,
  CONSTRAINT fk_ri_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Extend inventory movement types (idempotent value-level)
ALTER TABLE inventory_movements
  MODIFY COLUMN movement_type
  ENUM('IN','OUT','ADJUSTMENT','RETURN_IN','RETURN_OUT','DAMAGED','EXPIRED')
  NOT NULL;

-- ===========================================================================
-- PHASE 5 - DAMAGED & EXPIRY INVENTORY
-- ===========================================================================
CREATE TABLE IF NOT EXISTS damaged_inventory (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  quantity INT NOT NULL DEFAULT 0,
  source VARCHAR(50) DEFAULT 'return',
  reference_type VARCHAR(50) DEFAULT NULL,
  reference_id INT DEFAULT NULL,
  created_by INT DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_di_product (product_id),
  KEY idx_di_created (created_at),
  CONSTRAINT fk_di_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  CONSTRAINT fk_di_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS expired_inventory (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  quantity INT NOT NULL DEFAULT 0,
  expiry_date DATE DEFAULT NULL,
  source VARCHAR(50) DEFAULT 'return',
  reference_type VARCHAR(50) DEFAULT NULL,
  reference_id INT DEFAULT NULL,
  created_by INT DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ei_product (product_id),
  KEY idx_ei_expiry (expiry_date),
  CONSTRAINT fk_ei_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  CONSTRAINT fk_ei_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Track expiry on products for "expiring soon" alerts (additive)
CALL add_column_if_missing('products', 'expiry_date', 'DATE DEFAULT NULL AFTER min_stock_level');

-- ---------------------------------------------------------------------------
-- Cleanup helpers
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS add_column_if_missing;
DROP PROCEDURE IF EXISTS create_table_if_missing;
