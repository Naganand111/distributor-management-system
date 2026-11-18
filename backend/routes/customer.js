/* =====================================================
   CUSTOMER PANEL ROUTES
   All customer-scoped data is filtered by req.user.id in SQL
   so users can never access another user's resources.
===================================================== */

export default function registerCustomerRoutes(app, pool, authRequired) {
  const requireCustomer = (req, res, next) => {
    if (req.user?.role === "admin") return next();
    if (req.user?.role === "customer") return next();
    return res.status(403).json({ error: "Access denied" });
  };

  /* =====================================================
     CUSTOMER DASHBOARD
  ===================================================== */
  app.get("/api/customer/dashboard", authRequired, requireCustomer, async (req, res) => {
    try {
      const userId = req.user.id;

      const [[stats]] = await pool.query(
        `SELECT
           COUNT(*) AS totalOrders,
           COALESCE(SUM(status='pending'), 0) AS pendingOrders,
           COALESCE(SUM(status='processing'), 0) AS processingOrders,
           COALESCE(SUM(status='delivered'), 0) AS deliveredOrders,
           COALESCE(SUM(total_amount - discount), 0) AS totalSpent
         FROM orders
         WHERE user_id=?`,
        [userId]
      );

      const [recentOrders] = await pool.query(
        `SELECT
           o.id,
           o.total_amount,
           o.discount,
           o.gst,
           o.status,
           o.payment_status,
           o.created_at,
           (SELECT invoice_no FROM invoices i WHERE i.order_id=o.id) AS invoice_no,
           (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id=o.id) AS item_count
         FROM orders o
         WHERE o.user_id=?
         ORDER BY o.created_at DESC
         LIMIT 8`,
        [userId]
      );

      // Monthly purchase trend (last 6 months)
      const [monthlySeries] = await pool.query(
        `SELECT
           DATE_FORMAT(created_at, '%b %Y') AS label,
           DATE_FORMAT(created_at, '%Y-%m') AS bucket,
           CAST(SUM(total_amount - discount) AS DOUBLE) AS total
         FROM orders
         WHERE user_id=? AND status != 'cancelled'
         GROUP BY DATE_FORMAT(created_at, '%Y-%m'), DATE_FORMAT(created_at, '%b %Y')
         ORDER BY bucket ASC
         LIMIT 12`,
        [userId]
      );

      // Order status distribution
      const [statusDistribution] = await pool.query(
        `SELECT status, COUNT(*) AS count
         FROM orders
         WHERE user_id=?
         GROUP BY status`,
        [userId]
      );

      // Recent notifications for this customer
      const [recentNotifications] = await pool.query(
        `SELECT id, title, message, type, is_read, created_at
         FROM notifications
         WHERE user_id=?
         ORDER BY created_at DESC, id DESC
         LIMIT 6`,
        [userId]
      );

      res.json({
        totalOrders: Number(stats.totalOrders || 0),
        pendingOrders: Number(stats.pendingOrders || 0),
        processingOrders: Number(stats.processingOrders || 0),
        deliveredOrders: Number(stats.deliveredOrders || 0),
        totalSpent: Number(stats.totalSpent || 0),
        recentOrders,
        monthlySeries,
        statusDistribution,
        recentNotifications,
      });
    } catch (err) {
      console.error("CUSTOMER DASHBOARD ERROR:", err);
      res.status(500).json({ error: "Failed to load dashboard" });
    }
  });

  /* =====================================================
     RETAILERS (customer selection list - safe fields only)
  ===================================================== */
  app.get("/api/retailers/customer-list", authRequired, requireCustomer, async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT id, name, shop_name, city, state
         FROM retailers
         WHERE status='active'
         ORDER BY name ASC`
      );
      res.json(rows);
    } catch (err) {
      console.error("CUSTOMER RETAILER LIST ERROR:", err);
      res.status(500).json({ error: "Failed to load retailers" });
    }
  });

  /* =====================================================
     ORDER TRACKING (customer-scoped, uses order_status_history)
  ===================================================== */
  app.get("/api/orders/:id/tracking", authRequired, requireCustomer, async (req, res) => {
    try {
      const orderId = req.params.id;

      const [orderRows] = await pool.query(
        `SELECT o.*
         FROM orders o
         WHERE o.id=? AND (o.user_id=? OR ?='admin')`,
        [orderId, req.user.id, req.user.role]
      );

      if (!orderRows.length) {
        return res.status(403).json({ error: "Access denied" });
      }

      const [history] = await pool.query(
        `SELECT h.id, h.status, h.note, h.prev_status, h.created_at, u.name AS changed_by_name
         FROM order_status_history h
         LEFT JOIN users u ON h.changed_by = u.id
         WHERE h.order_id=?
         ORDER BY h.id ASC`,
        [orderId]
      );

      res.json({ order: orderRows[0], history });
    } catch (err) {
      console.error("ORDER TRACKING ERROR:", err);
      res.status(500).json({ error: "Server error" });
    }
  });

  /* =====================================================
     MY INVOICES
  ===================================================== */
  app.get("/api/invoices/my-invoices", authRequired, requireCustomer, async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT
           i.id, i.invoice_no, i.order_id, i.invoice_date,
           i.grand_total, i.subtotal, i.discount, i.gst_amount, i.payment_status
         FROM invoices i
         JOIN orders o ON i.order_id=o.id
         WHERE o.user_id=?
         ORDER BY i.invoice_date DESC`,
        [req.user.id]
      );
      res.json(rows);
    } catch (err) {
      console.error("MY INVOICES ERROR:", err);
      res.status(500).json({ error: "Server error" });
    }
  });

  /* =====================================================
     INVOICE DETAIL (customer-scoped)
  ===================================================== */
  app.get("/api/invoices/:id", authRequired, requireCustomer, async (req, res) => {
    try {
      const invoiceId = req.params.id;

      const [invRows] = await pool.query(
        `SELECT
           i.*, o.customer_name, o.created_at AS order_date, o.status AS order_status,
           o.shipping_name, o.shipping_address, o.shipping_city, o.shipping_state,
           o.shipping_pincode, o.shipping_mobile
         FROM invoices i
         JOIN orders o ON i.order_id=o.id
         WHERE i.id=? AND (o.user_id=? OR ?='admin')`,
        [invoiceId, req.user.id, req.user.role]
      );

      if (!invRows.length) {
        return res.status(403).json({ error: "Access denied" });
      }

      const [items] = await pool.query(
        `SELECT * FROM invoice_items WHERE invoice_id=?`,
        [invoiceId]
      );

      res.json({ invoice: invRows[0], items });
    } catch (err) {
      console.error("INVOICE DETAIL ERROR:", err);
      res.status(500).json({ error: "Server error" });
    }
  });

  /* =====================================================
     MY PAYMENTS
  ===================================================== */
  app.get("/api/payments/my-payments", authRequired, requireCustomer, async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT
           p.id AS payment_id,
           p.order_id,
           p.amount,
           p.method,
           p.note,
           p.created_at AS payment_date,
           (SELECT invoice_no FROM invoices i WHERE i.order_id=p.order_id) AS invoice_no,
           o.payment_status
         FROM payments p
         JOIN orders o ON p.order_id=o.id
         WHERE o.user_id=?
         ORDER BY p.created_at DESC`,
        [req.user.id]
      );
      res.json(rows);
    } catch (err) {
      console.error("MY PAYMENTS ERROR:", err);
      res.status(500).json({ error: "Server error" });
    }
  });

  /* =====================================================
     PROFILE
  ===================================================== */
  app.get("/api/profile", authRequired, requireCustomer, async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT id, name, email, role, mobile, address, city, state, pincode, retailer_id
         FROM users
         WHERE id=?`,
        [req.user.id]
      );

      if (!rows.length) {
        return res.status(404).json({ error: "User not found" });
      }

      res.json(rows[0]);
    } catch (err) {
      console.error("GET PROFILE ERROR:", err);
      res.status(500).json({ error: "Server error" });
    }
  });

  app.put("/api/profile", authRequired, requireCustomer, async (req, res) => {
    try {
      const { name, email, mobile, address, city, state, pincode, retailer_id } = req.body;

      if (!name || !name.trim()) {
        return res.status(400).json({ error: "Name is required" });
      }
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: "Invalid email address" });
      }

      const newEmail = String(email || "").toLowerCase() || null;

      if (newEmail) {
        const [dup] = await pool.query(
          "SELECT id FROM users WHERE email=? AND id<>?",
          [newEmail, req.user.id]
        );
        if (dup.length) {
          return res.status(400).json({ error: "Email already in use" });
        }
      }

      const retailerId = retailer_id ? Number(retailer_id) || null : null;

      await pool.query(
        `UPDATE users SET
           name=?, email=?, mobile=?, address=?, city=?, state=?, pincode=?, retailer_id=?
         WHERE id=?`,
        [name.trim(), newEmail || req.user.email, mobile || null, address || null,
         city || null, state || null, pincode || null, retailerId, req.user.id]
      );

      const [rows] = await pool.query(
        `SELECT id, name, email, role, mobile, address, city, state, pincode, retailer_id
         FROM users WHERE id=?`,
        [req.user.id]
      );

      res.json({ success: true, data: rows[0] });
    } catch (err) {
      console.error("UPDATE PROFILE ERROR:", err);
      res.status(500).json({ error: "Failed to update profile" });
    }
  });

  /* =====================================================
     CHANGE PASSWORD
  ===================================================== */
  app.put("/api/profile/change-password", authRequired, requireCustomer, async (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body;

      if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: "Current and new password are required" });
      }
      if (String(newPassword).length < 6) {
        return res.status(400).json({ error: "New password must be at least 6 characters" });
      }

      const [rows] = await pool.query("SELECT password FROM users WHERE id=?", [req.user.id]);
      if (!rows.length) {
        return res.status(404).json({ error: "User not found" });
      }

      const bcrypt = (await import("bcryptjs")).default;
      const match = await bcrypt.compare(String(currentPassword), rows[0].password);
      if (!match) {
        return res.status(400).json({ error: "Current password is incorrect" });
      }

      const hashed = await bcrypt.hash(String(newPassword), 10);
      await pool.query("UPDATE users SET password=? WHERE id=?", [hashed, req.user.id]);

      res.json({ success: true, message: "Password updated successfully" });
    } catch (err) {
      console.error("CHANGE PASSWORD ERROR:", err);
      res.status(500).json({ error: "Failed to change password" });
    }
  });
}
