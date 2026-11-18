import express from "express";

export default function registerSecurityRoutes(app, pool, authRequired, adminOnly) {
  const router = express.Router();

  router.get("/events", async (req, res) => {
    try {
      const { event_type, severity, user_id, from, to, search, page = 1, limit = 25 } = req.query;
      const offset = (Number(page) - 1) * Number(limit);
      let where = ["1=1"];
      const params = [];

      if (event_type) { where.push("e.event_type = ?"); params.push(event_type); }
      if (severity) { where.push("e.severity = ?"); params.push(severity); }
      if (user_id) { where.push("e.user_id = ?"); params.push(user_id); }
      if (from) { where.push("e.created_at >= ?"); params.push(from); }
      if (to) { where.push("e.created_at <= ?"); params.push(to); }
      if (search) { where.push("(e.description LIKE ? OR e.ip_address LIKE ?)"); params.push(`%${search}%`, `%${search}%`); }

      const [countRows] = await pool.query(
        `SELECT COUNT(*) AS total FROM security_events e WHERE ${where.join(" AND ")}`,
        params
      );

      const [events] = await pool.query(
        `SELECT e.*, u.name AS user_name
         FROM security_events e
         LEFT JOIN users u ON u.id = e.user_id
         WHERE ${where.join(" AND ")}
         ORDER BY e.created_at DESC
         LIMIT ? OFFSET ?`,
        [...params, Number(limit), offset]
      );

      res.json({ events, total: countRows[0].total, page: Number(page), limit: Number(limit) });
    } catch (err) {
      console.error("Security events error:", err);
      res.status(500).json({ error: "Failed to get events" });
    }
  });

  router.get("/dashboard", async (req, res) => {
    try {
      const [loginToday] = await pool.query(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN event_type = 'login_success' THEN 1 ELSE 0 END) AS successful,
                SUM(CASE WHEN event_type = 'login_failed' THEN 1 ELSE 0 END) AS failed
         FROM security_events
         WHERE event_type LIKE 'login_%' AND DATE(created_at) = CURDATE()`
      );

      const [loginWeek] = await pool.query(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN event_type = 'login_success' THEN 1 ELSE 0 END) AS successful,
                SUM(CASE WHEN event_type = 'login_failed' THEN 1 ELSE 0 END) AS failed
         FROM security_events
         WHERE event_type LIKE 'login_%' AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`
      );

      const [activeSessions] = await pool.query(
        "SELECT COUNT(*) AS total FROM user_sessions WHERE is_active = 1"
      );

      const [suspicious] = await pool.query(
        `SELECT ip_address, COUNT(*) AS attempts
         FROM security_events
         WHERE event_type = 'login_failed' AND created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)
         GROUP BY ip_address
         HAVING attempts > 5
         ORDER BY attempts DESC`
      );

      const [recentAdminActions] = await pool.query(
        `SELECT al.*, u.name AS user_name
         FROM activity_logs al
         LEFT JOIN users u ON u.id = al.user_id
         WHERE al.module IN ('ORDER', 'PRODUCT', 'USER', 'INVENTORY')
         ORDER BY al.created_at DESC
         LIMIT 20`
      );

      res.json({
        today: loginToday[0],
        thisWeek: loginWeek[0],
        activeSessions: activeSessions[0].total,
        suspicious,
        recentAdminActions,
      });
    } catch (err) {
      console.error("Security dashboard error:", err);
      res.status(500).json({ error: "Failed to get dashboard" });
    }
  });

  router.post("/events", async (req, res) => {
    try {
      const { userId, eventType, severity, description, ipAddress, userAgent, meta } = req.body;
      if (!eventType || !severity || !description) {
        return res.status(400).json({ error: "eventType, severity, description required" });
      }
      const [result] = await pool.query(
        "INSERT INTO security_events (user_id, event_type, severity, description, ip_address, user_agent, meta) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [userId || null, eventType, severity, description, ipAddress || null, userAgent || null, meta ? JSON.stringify(meta) : null]
      );
      res.status(201).json({ id: result.insertId, message: "Event logged" });
    } catch (err) {
      console.error("Log event error:", err);
      res.status(500).json({ error: "Failed to log event" });
    }
  });

  router.get("/sessions", async (req, res) => {
    try {
      // Explicit column list: `token` must never leave the server.
      const [sessions] = await pool.query(
        `SELECT s.id, s.user_id, s.device_info, s.is_active, s.created_at,
                u.name AS user_name
         FROM user_sessions s
         LEFT JOIN users u ON u.id = s.user_id
         WHERE s.is_active = 1
         ORDER BY s.created_at DESC`
      );
      res.json(sessions);
    } catch (err) {
      console.error("Sessions error:", err);
      res.status(500).json({ error: "Failed to get sessions" });
    }
  });

  router.post("/sessions/:id/revoke", async (req, res) => {
    try {
      const [result] = await pool.query(
        "UPDATE user_sessions SET is_active = 0 WHERE id = ?",
        [req.params.id]
      );
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: "Session not found" });
      }
      res.json({ message: "Session revoked" });
    } catch (err) {
      console.error("Revoke session error:", err);
      res.status(500).json({ error: "Failed to revoke session" });
    }
  });

  router.post("/sessions/revoke-all/:userId", async (req, res) => {
    try {
      const [result] = await pool.query(
        "UPDATE user_sessions SET is_active = 0 WHERE user_id = ? AND is_active = 1",
        [req.params.userId]
      );
      res.json({ message: "All sessions revoked", revoked: result.affectedRows });
    } catch (err) {
      console.error("Revoke all sessions error:", err);
      res.status(500).json({ error: "Failed to revoke sessions" });
    }
  });

  router.get("/password-changes", async (req, res) => {
    try {
      const [resets] = await pool.query(
        `SELECT pr.id, pr.email, pr.created_at, pr.is_used AS used
         FROM password_resets pr
         ORDER BY pr.created_at DESC
         LIMIT 100`
      );
      res.json(resets);
    } catch (err) {
      console.error("Password changes error:", err);
      res.status(500).json({ error: "Failed to get password changes" });
    }
  });

  router.get("/audit-log", async (req, res) => {
    try {
      const { action, user_id, from, to, page = 1, limit = 50 } = req.query;
      const offset = (Number(page) - 1) * Number(limit);
      let where = ["al.action IN ('LOGIN','CREATE','UPDATE','DELETE','CANCEL','PAYMENT')"];
      const params = [];
      if (action) { where.push("al.action = ?"); params.push(action); }
      if (user_id) { where.push("al.user_id = ?"); params.push(user_id); }
      if (from) { where.push("al.created_at >= ?"); params.push(from); }
      if (to) { where.push("al.created_at <= ?"); params.push(to); }

      const [logs] = await pool.query(
        `SELECT al.*, u.name AS user_name
         FROM activity_logs al
         LEFT JOIN users u ON u.id = al.user_id
         WHERE ${where.join(" AND ")}
         ORDER BY al.created_at DESC
         LIMIT ? OFFSET ?`,
        [...params, Number(limit), offset]
      );
      res.json(logs);
    } catch (err) {
      console.error("Audit log error:", err);
      res.status(500).json({ error: "Failed to get audit log" });
    }
  });

  app.use("/api/security", authRequired, adminOnly, router);
}
