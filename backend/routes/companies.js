import express from "express";

export default function registerCompanyRoutes(app, pool, authRequired, adminOnly) {
  const router = express.Router();
  const branchRouter = express.Router();

  // ── COMPANIES ──

  router.get("/", async (req, res) => {
    try {
      const [companies] = await pool.query(
        `SELECT c.*, COUNT(b.id) AS branch_count
         FROM companies c
         LEFT JOIN branches b ON b.company_id = c.id
         GROUP BY c.id
         ORDER BY c.name`
      );
      res.json(companies);
    } catch (err) {
      console.error("List companies error:", err);
      res.status(500).json({ error: "Failed to list companies" });
    }
  });

  router.post("/", async (req, res) => {
    try {
      const { name, code, gstin, email, phone, address, city, state } = req.body;
      if (!name || !code) return res.status(400).json({ error: "name and code required" });

      const [existing] = await pool.query("SELECT id FROM companies WHERE code = ?", [code]);
      if (existing.length > 0) return res.status(409).json({ error: "Company code already exists" });

      const [result] = await pool.query(
        "INSERT INTO companies (name, code, gstin, email, phone, address, city, state, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')",
        [name, code, gstin || null, email || null, phone || null, address || null, city || null, state || null]
      );
      res.status(201).json({ id: result.insertId, message: "Company created" });
    } catch (err) {
      console.error("Create company error:", err);
      res.status(500).json({ error: "Failed to create company" });
    }
  });

  router.put("/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { name, code, gstin, email, phone, address, city, state, status } = req.body;
      const fields = [];
      const params = [];
      if (name !== undefined) { fields.push("name = ?"); params.push(name); }
      if (code !== undefined) { fields.push("code = ?"); params.push(code); }
      if (gstin !== undefined) { fields.push("gstin = ?"); params.push(gstin); }
      if (email !== undefined) { fields.push("email = ?"); params.push(email); }
      if (phone !== undefined) { fields.push("phone = ?"); params.push(phone); }
      if (address !== undefined) { fields.push("address = ?"); params.push(address); }
      if (city !== undefined) { fields.push("city = ?"); params.push(city); }
      if (state !== undefined) { fields.push("state = ?"); params.push(state); }
      if (status !== undefined) { fields.push("status = ?"); params.push(status); }
      if (fields.length === 0) return res.status(400).json({ error: "Nothing to update" });
      params.push(id);
      await pool.query(`UPDATE companies SET ${fields.join(", ")} WHERE id = ?`, params);
      res.json({ message: "Company updated" });
    } catch (err) {
      console.error("Update company error:", err);
      res.status(500).json({ error: "Failed to update company" });
    }
  });

  router.get("/:id", async (req, res) => {
    try {
      const [companies] = await pool.query("SELECT * FROM companies WHERE id = ?", [req.params.id]);
      if (companies.length === 0) return res.status(404).json({ error: "Company not found" });

      const [branches] = await pool.query(
        "SELECT * FROM branches WHERE company_id = ? ORDER BY name",
        [req.params.id]
      );
      res.json({ ...companies[0], branches });
    } catch (err) {
      console.error("Company detail error:", err);
      res.status(500).json({ error: "Failed to get company" });
    }
  });

  router.get("/:id/summary", async (req, res) => {
    try {
      const { id } = req.params;
      const [orders] = await pool.query(
        "SELECT COUNT(*) AS order_count, COALESCE(SUM(total_amount), 0) AS revenue FROM orders WHERE company_id = ?",
        [id]
      );
      const [users] = await pool.query(
        "SELECT COUNT(*) AS user_count FROM users WHERE company_id = ?",
        [id]
      );
      res.json({
        order_count: orders[0].order_count,
        revenue: orders[0].revenue,
        user_count: users[0].user_count,
      });
    } catch (err) {
      console.error("Company summary error:", err);
      res.status(500).json({ error: "Failed to get summary" });
    }
  });

  router.delete("/:id", async (req, res) => {
    try {
      const { id } = req.params;
      if (Number(id) === 1) return res.status(400).json({ error: "Cannot delete default company" });
      await pool.query("UPDATE companies SET status = 'inactive' WHERE id = ?", [id]);
      res.json({ message: "Company deactivated" });
    } catch (err) {
      console.error("Delete company error:", err);
      res.status(500).json({ error: "Failed to delete company" });
    }
  });

  // ── BRANCHES ──

  branchRouter.get("/", async (req, res) => {
    try {
      const [branches] = await pool.query(
        `SELECT b.*, c.name AS company_name
         FROM branches b
         LEFT JOIN companies c ON c.id = b.company_id
         ORDER BY c.name, b.name`
      );
      res.json(branches);
    } catch (err) {
      console.error("List branches error:", err);
      res.status(500).json({ error: "Failed to list branches" });
    }
  });

  branchRouter.post("/", async (req, res) => {
    try {
      const { company_id, name, code, address, city, state, manager_name } = req.body;
      if (!company_id || !name || !code) return res.status(400).json({ error: "company_id, name, code required" });

      const [existing] = await pool.query("SELECT id FROM branches WHERE code = ?", [code]);
      if (existing.length > 0) return res.status(409).json({ error: "Branch code already exists" });

      const [result] = await pool.query(
        "INSERT INTO branches (company_id, name, code, address, city, state, manager_name, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'active')",
        [company_id, name, code, address || null, city || null, state || null, manager_name || null]
      );
      res.status(201).json({ id: result.insertId, message: "Branch created" });
    } catch (err) {
      console.error("Create branch error:", err);
      res.status(500).json({ error: "Failed to create branch" });
    }
  });

  branchRouter.put("/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { name, code, address, city, state, manager_name, status } = req.body;
      const fields = [];
      const params = [];
      if (name !== undefined) { fields.push("name = ?"); params.push(name); }
      if (code !== undefined) { fields.push("code = ?"); params.push(code); }
      if (address !== undefined) { fields.push("address = ?"); params.push(address); }
      if (city !== undefined) { fields.push("city = ?"); params.push(city); }
      if (state !== undefined) { fields.push("state = ?"); params.push(state); }
      if (manager_name !== undefined) { fields.push("manager_name = ?"); params.push(manager_name); }
      if (status !== undefined) { fields.push("status = ?"); params.push(status); }
      if (fields.length === 0) return res.status(400).json({ error: "Nothing to update" });
      params.push(id);
      await pool.query(`UPDATE branches SET ${fields.join(", ")} WHERE id = ?`, params);
      res.json({ message: "Branch updated" });
    } catch (err) {
      console.error("Update branch error:", err);
      res.status(500).json({ error: "Failed to update branch" });
    }
  });

  branchRouter.get("/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const [branches] = await pool.query("SELECT * FROM branches WHERE id = ?", [id]);
      if (branches.length === 0) return res.status(404).json({ error: "Branch not found" });

      const [users] = await pool.query("SELECT COUNT(*) AS user_count FROM users WHERE branch_id = ?", [id]);
      const [orders] = await pool.query("SELECT COUNT(*) AS order_count FROM orders WHERE branch_id = ?", [id]);

      res.json({ ...branches[0], user_count: users[0].user_count, order_count: orders[0].order_count });
    } catch (err) {
      console.error("Branch detail error:", err);
      res.status(500).json({ error: "Failed to get branch" });
    }
  });

  branchRouter.delete("/:id", async (req, res) => {
    try {
      const { id } = req.params;
      if (Number(id) === 1) return res.status(400).json({ error: "Cannot delete default branch" });
      await pool.query("UPDATE branches SET status = 'inactive' WHERE id = ?", [id]);
      res.json({ message: "Branch deactivated" });
    } catch (err) {
      console.error("Delete branch error:", err);
      res.status(500).json({ error: "Failed to delete branch" });
    }
  });

  // ── MOUNT ──
  app.use("/api/companies", authRequired, adminOnly, router);
  app.use("/api/branches", authRequired, adminOnly, branchRouter);
}
