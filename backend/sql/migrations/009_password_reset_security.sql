-- ---------------------------------------------------------------------------
-- 009_password_reset_security.sql
--
-- Adds the columns required by the hardened forgot/verify/reset password flow:
--   * attempts     - count of failed OTP verification attempts (limit enforced)
--   * verified_at  - timestamp of a successful OTP verification. reset-password
--                    only accepts a recent verified_at and consumes the row
--                    (is_used=1), making the OTP strictly single-use.
--
-- Idempotent: safe to run on databases that already have these columns.
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

CALL add_column_if_missing('password_resets', 'attempts',
  'INT NOT NULL DEFAULT 0');

CALL add_column_if_missing('password_resets', 'verified_at',
  'DATETIME NULL');

DROP PROCEDURE IF EXISTS add_column_if_missing;
