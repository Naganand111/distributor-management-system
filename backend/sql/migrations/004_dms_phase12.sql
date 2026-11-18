-- ---------------------------------------------------------------------------
-- Migration 004: Distributor Management System (Phase 1 + Phase 2).
--
-- Adds the master-data, inventory, sales, invoice and payment tables plus
-- extends the existing `products` and `orders` tables. All changes are
-- additive / non-destructive so existing data is preserved.
--
-- Idempotent (safe to run more than once). MySQL 8.0.29+ recommended.
-- --------------------------------------------------------------------------
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
-- Helper: create a table only if it does not exist yet.
-- ---------------------------------------------------------------------------
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
-- 1. CATEGORIES
-- ===========================================================================
CALL create_table_if_missing('categories', '
  CREATE TABLE categories (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(255) DEFAULT NULL,
    status ENUM("active","inactive") NOT NULL DEFAULT "active",
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_category_name (name)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
');

-- Seed default categories only if table was empty (example categories).
INSERT IGNORE INTO categories (name)
SELECT x.name FROM (SELECT 'Chocolates' AS name UNION SELECT 'Candies' UNION SELECT 'Biscuits' UNION SELECT 'Beverages' UNION SELECT 'Snacks') x
WHERE NOT EXISTS (SELECT 1 FROM categories);

-- ===========================================================================
-- 2. BRANDS
-- ===========================================================================
CALL create_table_if_missing('brands', '
  CREATE TABLE brands (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(255) DEFAULT NULL,
    status ENUM("active","inactive") NOT NULL DEFAULT "active",
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_brand_name (name)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
');

-- ===========================================================================
-- 3. SUPPLIERS
-- ===========================================================================
CALL create_table_if_missing('suppliers', '
  CREATE TABLE suppliers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    company_name VARCHAR(150) NOT NULL,
    contact_person VARCHAR(100) DEFAULT NULL,
    email VARCHAR(100) DEFAULT NULL,
    phone VARCHAR(30) DEFAULT NULL,
    gst VARCHAR(50) DEFAULT NULL,
    address VARCHAR(255) DEFAULT NULL,
    city VARCHAR(100) DEFAULT NULL,
    state VARCHAR(100) DEFAULT NULL,
    pincode VARCHAR(20) DEFAULT NULL,
    payable_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    status ENUM("active","inactive") NOT NULL DEFAULT "active",
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_supplier_company (company_name)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
');

-- ===========================================================================
-- 4. RETAILERS (links to existing users for backward compatibility)
-- ===========================================================================
CALL create_table_if_missing('retailers', '
  CREATE TABLE retailers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    retailer_code VARCHAR(30) DEFAULT NULL,
    name VARCHAR(150) NOT NULL,
    shop_name VARCHAR(150) DEFAULT NULL,
    owner_name VARCHAR(100) DEFAULT NULL,
    email VARCHAR(100) DEFAULT NULL,
    mobile VARCHAR(30) DEFAULT NULL,
    gst VARCHAR(50) DEFAULT NULL,
    address VARCHAR(255) DEFAULT NULL,
    city VARCHAR(100) DEFAULT NULL,
    state VARCHAR(100) DEFAULT NULL,
    pincode VARCHAR(20) DEFAULT NULL,
    credit_limit DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    outstanding_balance DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    status ENUM("active","inactive") NOT NULL DEFAULT "active",
    user_id INT DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_retailer_code (retailer_code),
    KEY idx_retailer_user (user_id),
    CONSTRAINT fk_retailers_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
');

-- Bring existing customers into retailers for backward compatibility
-- (only rows not already represented by retailer code = user id).
INSERT IGNORE INTO retailers (retailer_code, name, shop_name, owner_name, email, user_id, status)
SELECT CONCAT('R', u.id), u.name, NULL, u.name, u.email, u.id, 'active'
FROM users u
WHERE u.role = 'customer'
  AND NOT EXISTS (SELECT 1 FROM retailers r WHERE r.user_id = u.id);

-- ===========================================================================
-- 5. PRODUCTS - advanced columns (additive, existing rows preserved)
-- ===========================================================================
CALL add_column_if_missing('products', 'sku', 'VARCHAR(50) DEFAULT NULL AFTER name');
CALL add_column_if_missing('products', 'category_id', 'INT DEFAULT NULL AFTER sku');
CALL add_column_if_missing('products', 'brand_id', 'INT DEFAULT NULL AFTER category_id');
CALL add_column_if_missing('products', 'supplier_id', 'INT DEFAULT NULL AFTER brand_id');
CALL add_column_if_missing('products', 'purchase_price', 'DECIMAL(10,2) DEFAULT NULL AFTER price');
CALL add_column_if_missing('products', 'distributor_price', 'DECIMAL(10,2) DEFAULT NULL AFTER purchase_price');
CALL add_column_if_missing('products', 'retailer_price', 'DECIMAL(10,2) DEFAULT NULL AFTER distributor_price');
CALL add_column_if_missing('products', 'mrp', 'DECIMAL(10,2) DEFAULT NULL AFTER retailer_price');
CALL add_column_if_missing('products', 'gst_percent', 'DECIMAL(5,2) DEFAULT 0.00 AFTER mrp');
CALL add_column_if_missing('products', 'min_stock_level', 'INT NOT NULL DEFAULT 0 AFTER stock');
CALL add_column_if_missing('products', 'status', 'ENUM("active","inactive") NOT NULL DEFAULT "active" AFTER is_deleted');

-- Backfill: existing price is the distributor selling price.
UPDATE products SET distributor_price = price WHERE distributor_price IS NULL AND price IS NOT NULL;
UPDATE products SET retailer_price = price WHERE retailer_price IS NULL AND price IS NOT NULL;
UPDATE products SET mrp = price WHERE mrp IS NULL AND price IS NOT NULL;
UPDATE products SET min_stock_level = 5 WHERE min_stock_level = 0;
UPDATE products SET sku = CONCAT('SKU-', LPAD(id, 4, '0')) WHERE sku IS NULL OR sku = '';

-- Foreign keys on products (only if the referenced tables exist; added manually
-- for clarity but kept nullable so legacy rows remain valid).
-- (constrained via ALTER below; wrapped to be idempotent-safe with try semantics)

DROP PROCEDURE IF EXISTS add_fk_if_missing;
DELIMITER //
CREATE PROCEDURE add_fk_if_missing(
  IN p_constraint VARCHAR(64),
  IN p_alter_sql TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = p_constraint
  ) THEN
    SET @ddl = p_alter_sql;
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END//
DELIMITER ;

CALL add_fk_if_missing('fk_products_category', 'ALTER TABLE products ADD CONSTRAINT fk_products_category FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL');
CALL add_fk_if_missing('fk_products_brand', 'ALTER TABLE products ADD CONSTRAINT fk_products_brand FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE SET NULL');
CALL add_fk_if_missing('fk_products_supplier', 'ALTER TABLE products ADD CONSTRAINT fk_products_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL');

-- ===========================================================================
-- 6. INVENTORY MOVEMENTS
-- ===========================================================================
CREATE TABLE IF NOT EXISTS inventory_movements (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  movement_type ENUM('IN','OUT','ADJUSTMENT') NOT NULL,
  quantity INT NOT NULL,
  prev_stock INT NOT NULL,
  new_stock INT NOT NULL,
  reference_type VARCHAR(50) DEFAULT NULL,
  reference_id INT DEFAULT NULL,
  reason VARCHAR(255) DEFAULT NULL,
  created_by INT DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_inv_product (product_id),
  KEY idx_inv_type (movement_type),
  CONSTRAINT fk_inv_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  CONSTRAINT fk_inv_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ===========================================================================
-- 7. STOCK IN (purchases from suppliers)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS stock_in (
  id INT AUTO_INCREMENT PRIMARY KEY,
  supplier_id INT DEFAULT NULL,
  batch_number VARCHAR(100) DEFAULT NULL,
  notes VARCHAR(255) DEFAULT NULL,
  total_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  created_by INT DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_si_supplier (supplier_id),
  CONSTRAINT fk_si_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL,
  CONSTRAINT fk_si_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS stock_in_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  stock_in_id INT NOT NULL,
  product_id INT NOT NULL,
  quantity INT NOT NULL,
  purchase_price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  expiry_date DATE DEFAULT NULL,
  KEY idx_sii_stockin (stock_in_id),
  KEY idx_sii_product (product_id),
  CONSTRAINT fk_sii_stockin FOREIGN KEY (stock_in_id) REFERENCES stock_in(id) ON DELETE CASCADE,
  CONSTRAINT fk_sii_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ===========================================================================
-- 8. ORDERS - extend for distributor sales (additive)
-- ===========================================================================
CALL add_column_if_missing('orders', 'discount', 'DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER total_amount');
CALL add_column_if_missing('orders', 'paid_amount', 'DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER discount');
CALL add_column_if_missing('orders', 'retailer_id', 'INT DEFAULT NULL AFTER user_id');
CALL add_column_if_missing('orders', 'salesman', 'VARCHAR(100) DEFAULT NULL AFTER retailer_id');
CALL add_column_if_missing('orders', 'notes', 'VARCHAR(255) DEFAULT NULL AFTER salesman');

-- Keep legacy 'pending' values for backward compatibility.
-- New DMS can use unpaid, partially_paid and paid.
ALTER TABLE orders
  MODIFY COLUMN payment_status
  ENUM('pending','unpaid','partially_paid','paid')
  NOT NULL DEFAULT 'pending';

-- ===========================================================================
-- 9. ORDER STATUS HISTORY - add previous status
-- ===========================================================================
CALL add_column_if_missing(
  'order_status_history',
  'prev_status',
  'VARCHAR(30) DEFAULT NULL AFTER status'
);

-- ===========================================================================
-- 10. INVOICES (unique invoice per order - no duplicates)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS invoices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  invoice_no VARCHAR(50) NOT NULL,
  order_id INT NOT NULL,
  invoice_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  subtotal DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  discount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  taxable_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  gst_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  grand_total DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  payment_status VARCHAR(30) DEFAULT NULL,
  UNIQUE KEY uq_invoice_no (invoice_no),
  UNIQUE KEY uq_invoice_order (order_id),
  CONSTRAINT fk_invoices_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS invoice_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  invoice_id INT NOT NULL,
  product_id INT DEFAULT NULL,
  description VARCHAR(255) DEFAULT NULL,
  sku VARCHAR(50) DEFAULT NULL,
  quantity INT NOT NULL,
  rate DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  discount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  gst_percent DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  KEY idx_ii_invoice (invoice_id),
  CONSTRAINT fk_ii_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ===========================================================================
-- 11. PAYMENTS (basic tracking; fully expanded in Phase 3)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  payment_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  method VARCHAR(50) DEFAULT 'cash',
  note VARCHAR(255) DEFAULT NULL,
  created_by INT DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_pay_order (order_id),
  CONSTRAINT fk_pay_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_pay_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

DROP PROCEDURE IF EXISTS add_column_if_missing;
DROP PROCEDURE IF EXISTS create_table_if_missing;
DROP PROCEDURE IF EXISTS add_fk_if_missing;
