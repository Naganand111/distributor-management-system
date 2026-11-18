-- ---------------------------------------------------------------------------
-- Migration 010: Add `created_at` to `users`.
--
-- Fixes a schema/code mismatch: the admin dashboard query
-- (GET /api/dashboard/full -> recentCustomers in backend/server.js) selects
-- and orders by `users.created_at`, but the column was never defined in the
-- baseline `users` table nor added by any earlier migration, so the endpoint
-- returned HTTP 500 on a freshly migrated database.
--
-- Additive and idempotent: the helper procedure only adds the column when it
-- is missing (upgrade path). New databases get the column directly from the
-- updated baseline schema and the call below becomes a no-op.
-- ---------------------------------------------------------------------------
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

-- Default is CURRENT_TIMESTAMP so new users always get a valid value.
CALL add_column_if_missing('users', 'created_at',
  'TIMESTAMP DEFAULT CURRENT_TIMESTAMP');

-- Upgrade path: rows that existed before this column was added already get a
-- valid timestamp (the ADD COLUMN default backfills the ALTER time into every
-- existing row because the column is NOT NULL). This guard additionally covers
-- any NULL edge case on engines/settings that allow it.
UPDATE users
SET created_at = NOW()
WHERE created_at IS NULL;

DROP PROCEDURE IF EXISTS add_column_if_missing;