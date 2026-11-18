import { Router } from "express";
import pool from "../config/db.js";
import { authRequired, adminOnly } from "../config/authMiddleware.js";
import bcrypt from "bcryptjs";

const router = Router();

/**
 * 🔹 Get all customers (Admin only)
 */
router.get("/", authRequired, adminOnly, async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT
         u.id,
         u.name,
         u.email,
         u.role,
         u.mobile,
         u.address,
         u.city,
         u.state,
         u.pincode,
         u.created_at,
         (SELECT COUNT(*) FROM orders o WHERE o.user_id=u.id) AS orders_count,
         (SELECT COUNT(*) FROM orders o WHERE o.user_id=u.id AND o.status NOT IN ('cancelled')) AS active_orders_count,
         CAST((SELECT COALESCE(SUM(o.total_amount - o.discount),0) FROM orders o WHERE o.user_id=u.id AND o.status != 'cancelled') AS DOUBLE) AS total_spent,
         (SELECT MAX(o.created_at) FROM orders o WHERE o.user_id=u.id) AS last_order_at,
         (SELECT COALESCE(SUM(o.total_amount - o.discount),0) FROM orders o WHERE o.user_id=u.id AND o.payment_status='paid') AS total_paid
       FROM users u
       WHERE u.role='customer'
       ORDER BY u.id DESC`
    );

    res.json({ success: true, data: rows });
  } catch (err) {
    console.error("FULL ERROR (GET USERS):", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * 🔹 Get single customer by ID (Admin only)
 */
router.get("/:id", authRequired, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await pool.query(
      "SELECT id, name, email, role FROM users WHERE id=? AND role='customer'",
      [id]
    );

    if (!rows.length) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error("FULL ERROR (GET USER):", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * 🔹 Customer profile + order + payment history (Admin only)
 */
router.get("/:id/overview", authRequired, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;

    const [userRows] = await pool.query(
      `SELECT id, name, email, role, mobile, address, city, state, pincode, created_at
       FROM users WHERE id=? AND role='customer'`,
      [id]
    );

    if (!userRows.length) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const [orders] = await pool.query(
      `SELECT
         o.id, o.total_amount, o.discount, o.gst, o.status, o.payment_status, o.created_at,
         (SELECT invoice_no FROM invoices i WHERE i.order_id=o.id) AS invoice_no,
         (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id=o.id) AS item_count
       FROM orders o
       WHERE o.user_id=?
       ORDER BY o.created_at DESC
       LIMIT 50`,
      [id]
    );

    const [payments] = await pool.query(
      `SELECT p.id, p.order_id, p.amount, p.method, p.note, p.payment_date, p.created_at
       FROM payments p
       WHERE p.order_id IN (SELECT id FROM orders WHERE user_id=?)
       ORDER BY p.payment_date DESC, p.id DESC
       LIMIT 50`,
      [id]
    );

    res.json({ success: true, data: { user: userRows[0], orders, payments } });
  } catch (err) {
    console.error("FULL ERROR (GET USER OVERVIEW):", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * 🔹 Create a new user (Admin only)
 */
router.post("/", authRequired, adminOnly, async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Name, email and password are required",
      });
    }

    // Check if email already exists
    const [exists] = await pool.query(
      "SELECT id FROM users WHERE email=?",
      [email]
    );

    if (exists.length) {
      return res
        .status(400)
        .json({ success: false, message: "Email already registered" });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    const userRole =
      role && ["customer", "admin"].includes(role) ? role : "customer";

    const [result] = await pool.query(
      "INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)",
      [name, email.toLowerCase(), hashedPassword, userRole]
    );

    res.json({
      success: true,
      message: "User created successfully",
      data: { id: result.insertId, name, email, role: userRole },
    });
  } catch (err) {
    console.error("FULL ERROR (CREATE USER):", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * 🔹 Delete a customer (Admin only)
 */
router.delete("/:id", authRequired, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;

    const [existing] = await pool.query(
      "SELECT id FROM users WHERE id=? AND role='customer'",
      [id]
    );

    if (!existing.length) {
      return res.status(404).json({
        success: false,
        message: "User not found or not a customer",
      });
    }

    const [result] = await pool.query(
      "DELETE FROM users WHERE id=?",
      [id]
    );

    if (result.affectedRows === 0) {
      return res
        .status(400)
        .json({ success: false, message: "Delete failed" });
    }

    res.json({ success: true, message: "Customer deleted successfully" });
  } catch (err) {
    console.error("FULL ERROR (DELETE USER):", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;