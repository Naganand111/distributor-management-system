-- ---------------------------------------------------------------------------
-- Migration 011: Payment integrity — gateway identity and idempotency keys.
--
-- PHASE 5 (payment system / Razorpay integrity).
--
-- WHY THIS EXISTS
--   `payments` recorded only `order_id`, `amount`, `method`, `note`. Nothing
--   stored WHICH gateway payment produced the row, so:
--     * a replayed /api/payment/verify inserted a second identical row,
--     * a second notification and a second loyalty credit were issued,
--     * and no database-level guarantee stopped a duplicate capture.
--   The database is the only place where "this gateway payment was already
--   processed" can be enforced atomically, under concurrency. That requires a
--   unique key on the gateway payment id.
--
--   `orders` stored `razorpay_order_id` but not the amount that order was
--   authorised for. Without the authorised amount, a payment cannot be bound to
--   the authoritative order total at verification time, and the amount a
--   customer was actually charged is not auditable from the database.
--
-- WHAT IS ADDED (no existing column is redefined or dropped)
--   orders.razorpay_amount        DECIMAL(12,2) NULL
--        Rupees the current pending gateway order was authorised for. Written
--        by /api/payment/create-order from the server-calculated order total.
--   payments.gateway              VARCHAR(20)  NULL   ('razorpay', else NULL)
--   payments.gateway_order_id     VARCHAR(100) NULL
--   payments.gateway_payment_id   VARCHAR(100) NULL
--   payments.currency             VARCHAR(3)   NULL
--
--   UNIQUE KEY uq_payments_gateway_payment (gateway_payment_id)
--        The idempotency guarantee. MySQL allows unlimited NULLs in a UNIQUE
--        index, so all pre-existing rows (which have no gateway reference and
--        are cash/manual records) are untouched, and two concurrent verifies of
--        the same gateway payment can never both commit a row.
--
-- PAYMENT STATES
--   No new status column is introduced. The project already models payment
--   state with `orders.payment_status` ENUM('pending','unpaid','partially_paid',
--   'paid'), and `payments` is deliberately "money actually received": revenue
--   reporting (`/api/reports/summary`, advanced reports) sums `payments.amount`.
--   Storing FAILED/ATTEMPTED rows here would silently corrupt revenue, so failed
--   or abandoned attempts are deliberately NOT recorded. A payment row's
--   existence therefore means "captured money", which is the existing
--   convention this project already relies on.
--
-- Idempotent (safe to run more than once). Historical rows are never rewritten.
-- ---------------------------------------------------------------------------
USE oms;

DROP PROCEDURE IF EXISTS add_column_if_missing;
DROP PROCEDURE IF EXISTS add_index_if_missing;

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

CREATE PROCEDURE add_index_if_missing(
  IN p_table VARCHAR(64),
  IN p_index VARCHAR(64),
  IN p_columns TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = p_table
      AND INDEX_NAME = p_index
  ) THEN
    SET @ddl = CONCAT('ALTER TABLE `', p_table, '` ADD ', IF(
      p_index LIKE 'uq%', 'UNIQUE KEY', 'KEY'),
      ' `', p_index, '` (', p_columns, ')');
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END//

DELIMITER ;

-- Amount (rupees) the pending gateway order was authorised for.
CALL add_column_if_missing('orders', 'razorpay_amount',
  'DECIMAL(12,2) NULL AFTER razorpay_order_id');

-- Gateway identity on a received payment.
CALL add_column_if_missing('payments', 'gateway',
  'VARCHAR(20) NULL DEFAULT NULL AFTER created_by');
CALL add_column_if_missing('payments', 'gateway_order_id',
  'VARCHAR(100) NULL DEFAULT NULL AFTER gateway');
CALL add_column_if_missing('payments', 'gateway_payment_id',
  'VARCHAR(100) NULL DEFAULT NULL AFTER gateway_order_id');
CALL add_column_if_missing('payments', 'currency',
  'VARCHAR(3) NULL DEFAULT NULL AFTER gateway_payment_id');

-- Idempotency + traceability. Pre-existing rows are all NULL here, so the
-- unique key cannot collide with historical data.
CALL add_index_if_missing('payments', 'uq_payments_gateway_payment',
  '`gateway_payment_id`');
CALL add_index_if_missing('payments', 'idx_payments_gateway_order',
  '`gateway_order_id`');

DROP PROCEDURE IF EXISTS add_column_if_missing;
DROP PROCEDURE IF EXISTS add_index_if_missing;