/* =====================================================
   PHASE 6 - NOTIFICATIONS
   Users can only see and mutate their own notifications.
===================================================== */

export default function registerNotificationRoutes(app, pool, authRequired) {
  /* Operator to resolve user ownership. Requests always pass authRequired. */

  app.get("/api/notifications", authRequired, async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const [rows] = await pool.query(
        `SELECT id, title, message, type, is_read, reference_type, reference_id, created_at
         FROM notifications
         WHERE user_id=?
         ORDER BY created_at DESC
         LIMIT ?`,
        [req.user.id, limit]
      );
      res.json(rows);
    } catch (err) {
      console.error("GET NOTIFICATIONS ERROR:", err);
      res.status(500).json({ error: "Server error" });
    }
  });

  app.get("/api/notifications/unread-count", authRequired, async (req, res) => {
    try {
      const [[row]] = await pool.query(
        `SELECT COUNT(*) AS unread
         FROM notifications
         WHERE user_id=? AND is_read=0`,
        [req.user.id]
      );
      res.json({ unread: Number(row.unread || 0) });
    } catch (err) {
      console.error("NOTIFICATION UNREAD COUNT ERROR:", err);
      res.status(500).json({ error: "Server error" });
    }
  });

  app.put("/api/notifications/:id/read", authRequired, async (req, res) => {
    try {
      const [result] = await pool.query(
        `UPDATE notifications SET is_read=1
         WHERE id=? AND user_id=?`,
        [req.params.id, req.user.id]
      );
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: "Notification not found" });
      }
      res.json({ success: true });
    } catch (err) {
      console.error("MARK NOTIFICATION READ ERROR:", err);
      res.status(500).json({ error: "Server error" });
    }
  });

  app.put("/api/notifications/read-all", authRequired, async (req, res) => {
    try {
      await pool.query(
        `UPDATE notifications SET is_read=1 WHERE user_id=?`,
        [req.user.id]
      );
      res.json({ success: true });
    } catch (err) {
      console.error("MARK ALL NOTIFICATIONS READ ERROR:", err);
      res.status(500).json({ error: "Server error" });
    }
  });

  app.delete("/api/notifications/:id", authRequired, async (req, res) => {
    try {
      const [result] = await pool.query(
        `DELETE FROM notifications WHERE id=? AND user_id=?`,
        [req.params.id, req.user.id]
      );
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: "Notification not found" });
      }
      res.json({ success: true });
    } catch (err) {
      console.error("DELETE NOTIFICATION ERROR:", err);
      res.status(500).json({ error: "Server error" });
    }
  });
}
