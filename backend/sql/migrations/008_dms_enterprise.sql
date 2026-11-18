-- ============================================================
-- 008_dms_enterprise.sql
-- Enterprise DMS upgrade: AI assistant, sales routes & visits,
-- promotions, warehouses & transfers, delivery management,
-- loyalty, multi-company/branch, security events, expenses.
-- Non-breaking: existing tables/columns are untouched.
-- Column-level adds (products.barcode, users.*, orders.*) are
-- handled below with IF NOT EXISTS guards where supported and
-- by the migration runner (duplicates => warnings) otherwise.
-- ============================================================

-- ---------- Multi-company / branch ----------
CREATE TABLE IF NOT EXISTS companies (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  code VARCHAR(30) UNIQUE,
  gstin VARCHAR(30),
  email VARCHAR(100),
  phone VARCHAR(30),
  address VARCHAR(255),
  city VARCHAR(100),
  state VARCHAR(100),
  status ENUM('active','inactive') DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS branches (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_id INT NOT NULL,
  name VARCHAR(150) NOT NULL,
  code VARCHAR(30) UNIQUE,
  address VARCHAR(255),
  city VARCHAR(100),
  state VARCHAR(100),
  manager_name VARCHAR(100),
  status ENUM('active','inactive') DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_branch_company FOREIGN KEY (company_id) REFERENCES companies(id)
) ENGINE=InnoDB;

-- ---------- AI assistant ----------
CREATE TABLE IF NOT EXISTS ai_conversations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  title VARCHAR(200) DEFAULT 'New conversation',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_ai_conv_user (user_id, updated_at),
  CONSTRAINT fk_ai_conv_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS ai_messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  conversation_id INT NOT NULL,
  role ENUM('user','assistant') NOT NULL,
  content TEXT NOT NULL,
  meta LONGTEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ai_msg_conv (conversation_id),
  CONSTRAINT fk_ai_msg_conv FOREIGN KEY (conversation_id) REFERENCES ai_conversations(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------- Sales routes & visits ----------
CREATE TABLE IF NOT EXISTS sales_routes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  route_code VARCHAR(30) UNIQUE,
  sales_rep_id INT NOT NULL,
  route_date DATE NOT NULL,
  status ENUM('planned','in_progress','completed','cancelled') DEFAULT 'planned',
  notes VARCHAR(255),
  created_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_route_rep_date (sales_rep_id, route_date),
  CONSTRAINT fk_route_rep FOREIGN KEY (sales_rep_id) REFERENCES sales_representatives(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sales_route_stops (
  id INT AUTO_INCREMENT PRIMARY KEY,
  route_id INT NOT NULL,
  retailer_id INT NOT NULL,
  stop_order INT NOT NULL DEFAULT 1,
  status ENUM('pending','completed','skipped','cancelled') DEFAULT 'pending',
  arrival_time DATETIME NULL,
  departure_time DATETIME NULL,
  notes VARCHAR(255),
  INDEX idx_route_stop (route_id),
  CONSTRAINT fk_route_stop_route FOREIGN KEY (route_id) REFERENCES sales_routes(id) ON DELETE CASCADE,
  CONSTRAINT fk_route_stop_retailer FOREIGN KEY (retailer_id) REFERENCES retailers(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS retailer_visits (
  id INT AUTO_INCREMENT PRIMARY KEY,
  visit_number VARCHAR(30) UNIQUE,
  route_stop_id INT NULL,
  route_id INT NULL,
  retailer_id INT NOT NULL,
  sales_rep_id INT NOT NULL,
  visit_date DATE NOT NULL,
  check_in_at DATETIME NULL,
  check_out_at DATETIME NULL,
  duration_minutes INT NULL,
  status ENUM('planned','in_progress','completed','skipped','cancelled') DEFAULT 'planned',
  order_id INT NULL,
  sales_amount DECIMAL(12,2) DEFAULT 0,
  notes TEXT,
  follow_up_date DATE NULL,
  lat DECIMAL(10,7) NULL,
  lng DECIMAL(10,7) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_visit_rep_date (sales_rep_id, visit_date),
  INDEX idx_visit_retailer (retailer_id),
  CONSTRAINT fk_visit_retailer FOREIGN KEY (retailer_id) REFERENCES retailers(id),
  CONSTRAINT fk_visit_rep FOREIGN KEY (sales_rep_id) REFERENCES sales_representatives(id)
) ENGINE=InnoDB;

-- ---------- Promotions engine ----------
CREATE TABLE IF NOT EXISTS promotions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(50) UNIQUE,
  name VARCHAR(150) NOT NULL,
  description VARCHAR(255),
  type ENUM('percentage','fixed','buy_x_get_y','min_order','product','category','customer','quantity') NOT NULL,
  value DECIMAL(12,2) NOT NULL DEFAULT 0,
  min_order_value DECIMAL(12,2) DEFAULT 0,
  buy_qty INT NULL,
  get_qty INT NULL,
  product_id INT NULL,
  category_id INT NULL,
  customer_id INT NULL,
  start_date DATE NULL,
  end_date DATE NULL,
  usage_limit INT NULL,
  used_count INT DEFAULT 0,
  priority INT DEFAULT 0,
  status ENUM('active','inactive') DEFAULT 'active',
  created_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_promo_status_date (status, start_date, end_date)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS promotion_usage (
  id INT AUTO_INCREMENT PRIMARY KEY,
  promotion_id INT NOT NULL,
  order_id INT NOT NULL,
  user_id INT NULL,
  discount_applied DECIMAL(12,2) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_promo_usage (promotion_id),
  CONSTRAINT fk_pu_promo FOREIGN KEY (promotion_id) REFERENCES promotions(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------- Warehouses & transfers ----------
CREATE TABLE IF NOT EXISTS warehouses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  code VARCHAR(30) UNIQUE,
  address VARCHAR(255),
  city VARCHAR(100),
  state VARCHAR(100),
  manager_name VARCHAR(100),
  phone VARCHAR(30),
  status ENUM('active','inactive') DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS warehouse_inventory (
  id INT AUTO_INCREMENT PRIMARY KEY,
  warehouse_id INT NOT NULL,
  product_id INT NOT NULL,
  quantity INT NOT NULL DEFAULT 0,
  reserved INT NOT NULL DEFAULT 0,
  UNIQUE KEY uq_wh_product (warehouse_id, product_id),
  CONSTRAINT fk_wh_inv_wh FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE CASCADE,
  CONSTRAINT fk_wh_inv_prod FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS stock_transfers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  transfer_number VARCHAR(30) UNIQUE,
  from_warehouse_id INT NOT NULL,
  to_warehouse_id INT NOT NULL,
  status ENUM('requested','approved','dispatched','received','completed','cancelled') DEFAULT 'requested',
  requested_by INT,
  approved_by INT NULL,
  note VARCHAR(255),
  transfer_date DATE NULL,
  received_date DATE NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_transfer_from FOREIGN KEY (from_warehouse_id) REFERENCES warehouses(id),
  CONSTRAINT fk_transfer_to FOREIGN KEY (to_warehouse_id) REFERENCES warehouses(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS stock_transfer_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  transfer_id INT NOT NULL,
  product_id INT NOT NULL,
  quantity INT NOT NULL,
  CONSTRAINT fk_ti_transfer FOREIGN KEY (transfer_id) REFERENCES stock_transfers(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------- Delivery management ----------
CREATE TABLE IF NOT EXISTS delivery_persons (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NULL,
  name VARCHAR(150) NOT NULL,
  phone VARCHAR(30),
  vehicle_number VARCHAR(30),
  vehicle_type VARCHAR(50),
  status ENUM('active','inactive') DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ---------- Loyalty ----------
CREATE TABLE IF NOT EXISTS loyalty_accounts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  points_balance INT NOT NULL DEFAULT 0,
  total_earned INT NOT NULL DEFAULT 0,
  total_redeemed INT NOT NULL DEFAULT 0,
  UNIQUE KEY uq_loyalty_user (user_id),
  CONSTRAINT fk_loyalty_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS loyalty_transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  type ENUM('earn','redeem','adjust','expire') NOT NULL,
  points INT NOT NULL,
  balance_after INT NOT NULL DEFAULT 0,
  reference_type VARCHAR(50),
  reference_id INT,
  note VARCHAR(255),
  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_loyalty_tx_user (user_id, created_at),
  CONSTRAINT fk_ltx_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS loyalty_config (
  id INT AUTO_INCREMENT PRIMARY KEY,
  points_per_100_rupees INT NOT NULL DEFAULT 1,
  redemption_min_points INT NOT NULL DEFAULT 100,
  points_to_rupee INT NOT NULL DEFAULT 1,
  expiry_days INT NULL,
  status ENUM('active','inactive') DEFAULT 'active',
  updated_by INT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ---------- Security events ----------
CREATE TABLE IF NOT EXISTS security_events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NULL,
  event_type VARCHAR(50) NOT NULL,
  severity ENUM('info','warning','critical') DEFAULT 'info',
  description VARCHAR(255),
  ip_address VARCHAR(45),
  user_agent VARCHAR(255),
  meta VARCHAR(500),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_sec_event_type (event_type, created_at),
  INDEX idx_sec_event_user (user_id)
) ENGINE=InnoDB;

-- ---------- Expenses (financial reports) ----------
CREATE TABLE IF NOT EXISTS expenses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  category VARCHAR(50),
  description VARCHAR(255),
  amount DECIMAL(12,2) NOT NULL,
  expense_date DATE NOT NULL,
  created_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_expense_date (expense_date)
) ENGINE=InnoDB;

-- ---------- Column additions (guarded by runner) ----------
ALTER TABLE products ADD COLUMN barcode VARCHAR(64) NULL AFTER sku;
ALTER TABLE products ADD INDEX idx_products_barcode (barcode);

ALTER TABLE users ADD COLUMN company_id INT NULL AFTER role;
ALTER TABLE users ADD COLUMN branch_id INT NULL AFTER company_id;
ALTER TABLE users ADD COLUMN is_active TINYINT(1) DEFAULT 1 AFTER branch_id;
ALTER TABLE users MODIFY role ENUM('admin','customer','sales_rep','delivery') NOT NULL DEFAULT 'customer';

ALTER TABLE orders ADD COLUMN company_id INT NULL;
ALTER TABLE orders ADD COLUMN branch_id INT NULL;

-- Seed default company/branch (single-company compatibility)
INSERT INTO companies (id, name, code, status) SELECT 1, 'Default Company', 'DEFAULT', 'active'
  WHERE NOT EXISTS (SELECT 1 FROM companies WHERE id = 1);
INSERT INTO branches (id, company_id, name, code, status) SELECT 1, 1, 'Head Office', 'HQ', 'active'
  WHERE NOT EXISTS (SELECT 1 FROM branches WHERE id = 1);

-- Seed loyalty config defaults
INSERT INTO loyalty_config (id, points_per_100_rupees, redemption_min_points, points_to_rupee, status)
  SELECT 1, 1, 100, 1, 'active' WHERE NOT EXISTS (SELECT 1 FROM loyalty_config WHERE id = 1);