/* =====================================================
   PHASE 6 - ACTIVITY / AUDIT LOGS
   Admin only. Supports filters + pagination.
===================================================== */

export default function registerActivityLogRoutes(app, pool, authRequired, adminOnly) {
  const guard = [authRequired, adminOnly];

  app.get("/api/activity-logs", ...guard, async (req, res) => {
    try {
      const page = Math.max(Number(req.query.page) || 1, 1);
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const offset = (page - 1) * limit;

      const {
        user_id, module, action, from, to, search,
      } = req.query;

      const conditions = [];
      const params = [];

      if (user_id) {
        conditions.push("al.user_id = ?");
        params.push(user_id);
      }
      if (module) {
        conditions.push("al.module = ?");
        params.push(module);
      }
      if (action) {
        conditions.push("al.action = ?");
        params.push(action);
      }
      if (from) {
        conditions.push("al.created_at >= ?");
        params.push(`${from} 00:00:00`);
      }
      if (to) {
        conditions.push("al.created_at <= ?");
        params.push(`${to} 23:59:59`);
      }
      if (search) {
        conditions.push("(al.description LIKE ? OR al.reference_type LIKE ? OR u.name LIKE ?)");
        const like = `%${search}%`;
        params.push(like, like, like);
      }

      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

      const [[countRow]] = await pool.query(
        `SELECT COUNT(*) AS total FROM activity_logs al LEFT JOIN users u ON u.id=al.user_id ${where}`,
        params
      );

      const [rows] = await pool.query(
        `SELECT al.id, al.user_id, al.action, al.module, al.description,
                al.reference_type, al.reference_id, al.ip_address, al.created_at,
                COALESCE(u.name, 'System') AS user_name
         FROM activity_logs al
         LEFT JOIN users u ON u.id = al.user_id
         ${where}
         ORDER BY al.created_at DESC, al.id DESC
         LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      );

      const total = Number(countRow.total || 0);
      res.json({
        data: rows,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (err) {
      console.error("GET ACTIVITY LOGS ERROR:", err);
      res.status(500).json({ error: "Server error" });
    }
  });

  app.get("/api/activity-logs/:id", ...guard, async (req, res) => {
    try {
      const [[row]] = await pool.query(
        `SELECT al.*, COALESCE(u.name, 'System') AS user_name
         FROM activity_logs al
         LEFT JOIN users u ON u.id = al.user_id
         WHERE al.id=?`,
        [req.params.id]
      );
      if (!row) return res.status(404).json({ error: "Activity log not found" });
      res.json(row);
    } catch (err) {
      console.error("GET ACTIVITY LOG ERROR:", err);
      res.status(500).json({ error: "Server error" });
    }
  });
}
