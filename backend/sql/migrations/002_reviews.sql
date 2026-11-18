-- ---------------------------------------------------------------------------
-- Migration 002: Product reviews & ratings.
--
-- Adds the `reviews` table so customers who purchased a product can leave a
-- star rating (1-5) and an optional comment. One review per (product, user);
-- re-submitting updates the existing review instead of failing.
--
-- Idempotent (safe to run more than once). MySQL 8.0.29+ recommended.
-- --------------------------------------------------------------------------
USE oms;

CREATE TABLE IF NOT EXISTS reviews (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  user_id INT NOT NULL,
  rating TINYINT NOT NULL,
  comment TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_review_product_user (product_id, user_id),
  CONSTRAINT fk_reviews_product FOREIGN KEY (product_id) REFERENCES products(id),
  CONSTRAINT fk_reviews_user FOREIGN KEY (user_id) REFERENCES users(id)
);