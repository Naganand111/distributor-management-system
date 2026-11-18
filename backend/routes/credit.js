import express from "express";

export default function registerCreditRoutes(app, pool, authRequired, adminOnly) {
  const router = express.Router();

  /* =====================================================
     GET /dashboard — credit & collections summary
  ===================================================== */

  router.get("/dashboard", async (req, res) => {
    try {
      const [[outstandingRow]] = await pool.query(
        `SELECT COALESCE(SUM(outstanding_balance), 0) AS total
         FROM retailers
         WHERE outstanding_balance > 0 AND status = 'active'`
      );

      const [overdueRows] = await pool.query(
        `SELECT r.id, r.name, r.outstanding_balance,
                COALESCE((
                  SELECT SUM(rct.amount)
                  FROM retailer_credit_transactions rct
                  WHERE rct.retailer_id = r.id
                    AND rct.transaction_type = 'CREDIT'
                    AND rct.due_date < CURDATE()
                ), 0) AS credit_due_amount
         FROM retailers r
         WHERE r.status = 'active' AND r.outstanding_balance > 0`
      );

      let totalOverdue = 0;
      const overdueRetailers = overdueRows.map((r) => {
        const overdue = Math.min(Number(r.outstanding_balance), Number(r.credit_due_amount));
        totalOverdue += overdue;
        return { ...r, overdue };
      });

      const [[dueWeekRow]] = await pool.query(
        `SELECT COALESCE(SUM(amount), 0) AS due
         FROM retailer_credit_transactions
         WHERE transaction_type = 'CREDIT'
           AND due_date >= CURDATE()
           AND due_date <= DATE_ADD(CURDATE(), INTERVAL 7 DAY)`
      );

      const [[dueMonthRow]] = await pool.query(
        `SELECT COALESCE(SUM(amount), 0) AS due
         FROM retailer_credit_transactions
         WHERE transaction_type = 'CREDIT'
           AND due_date >= CURDATE()
           AND due_date <= LAST_DAY(CURDATE())`
      );

      const [[collectionRow]] = await pool.query(
        `SELECT COALESCE(SUM(amount), 0) AS total,
                COUNT(*) AS count
         FROM collections
         WHERE status = 'completed'`
      );

      const [retailers] = await pool.query(
        `SELECT
           r.id,
           r.retailer_code,
           r.name,
           r.shop_name,
           r.credit_limit,
           r.outstanding_balance,
           r.status,
           CASE WHEN r.credit_limit > 0
             THEN GREATEST(r.credit_limit - r.outstanding_balance, 0)
             ELSE NULL
           END AS available_credit,
           COALESCE((
             SELECT SUM(rct.amount)
             FROM retailer_credit_transactions rct
             WHERE rct.retailer_id = r.id
               AND rct.transaction_type = 'CREDIT'
               AND rct.due_date < CURDATE()
           ), 0) AS credit_past_due
         FROM retailers r
         WHERE r.status = 'active'
         ORDER BY r.outstanding_balance DESC`
      );

      const retailerList = retailers.map((r) => ({
        ...r,
        overdue: Math.min(Number(r.outstanding_balance), Number(r.credit_past_due)),
      }));

      res.json({
        summary: {
          totalOutstanding: Number(outstandingRow.total),
          overdue: Number(totalOverdue.toFixed(2)),
          overdueRetailerCount: overdueRetailers.length,
          dueThisWeek: Number(dueWeekRow.due),
          dueThisMonth: Number(dueMonthRow.due),
          totalCollections: Number(collectionRow.total),
          collectionCount: Number(collectionRow.count),
        },
        retailers: retailerList,
      });
    } catch (err) {
      console.error("CREDIT DASHBOARD ERROR:", err);
      res.status(500).json({ error: "Failed to fetch credit dashboard" });
    }
  });

  /* =====================================================
     GET /overdue — all retailers with overdue amounts
  ===================================================== */

  router.get("/overdue", async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT r.id, r.retailer_code, r.name, r.shop_name,
                r.credit_limit, r.outstanding_balance,
                COALESCE((
                  SELECT SUM(rct.amount)
                  FROM retailer_credit_transactions rct
                  WHERE rct.retailer_id = r.id
                    AND rct.transaction_type = 'CREDIT'
                    AND rct.due_date < CURDATE()
                ), 0) AS credit_past_due,
                (
                  SELECT MIN(rct.due_date)
                  FROM retailer_credit_transactions rct
                  WHERE rct.retailer_id = r.id
                    AND rct.transaction_type = 'CREDIT'
                    AND rct.due_date < CURDATE()
                ) AS oldest_due_date
         FROM retailers r
         WHERE r.status = 'active'
           AND r.outstanding_balance > 0
         HAVING credit_past_due > 0
         ORDER BY credit_past_due DESC`
      );

      const result = rows.map((r) => ({
        ...r,
        overdue: Math.min(Number(r.outstanding_balance), Number(r.credit_past_due)),
      }));

      res.json(result);
    } catch (err) {
      console.error("GET OVERDUE ERROR:", err);
      res.status(500).json({ error: "Failed to fetch overdue retailers" });
    }
  });

  /* =====================================================
     GET /retailer/:id — retailer credit detail
  ===================================================== */

  router.get("/retailer/:id", async (req, res) => {
    try {
      const [retRows] = await pool.query(
        `SELECT
           r.id,
           r.retailer_code,
           r.name,
           r.shop_name,
           r.owner_name,
           r.credit_limit,
           r.outstanding_balance,
           r.status,
           COALESCE((
             SELECT SUM(rct.amount)
             FROM retailer_credit_transactions rct
             WHERE rct.retailer_id = r.id
               AND rct.transaction_type = 'CREDIT'
               AND rct.due_date < CURDATE()
           ), 0) AS credit_past_due
         FROM retailers r
         WHERE r.id=?`,
        [req.params.id]
      );

      if (!retRows.length) {
        return res.status(404).json({ error: "Retailer not found" });
      }

      const ret = retRows[0];
      const creditLimit = Number(ret.credit_limit || 0);
      const outstanding = Number(ret.outstanding_balance || 0);

      const [transactions] = await pool.query(
        `SELECT * FROM retailer_credit_transactions
         WHERE retailer_id = ?
         ORDER BY created_at DESC, id DESC
         LIMIT 100`,
        [req.params.id]
      );

      const [collections] = await pool.query(
        `SELECT * FROM collections
         WHERE retailer_id = ?
         ORDER BY created_at DESC, id DESC
         LIMIT 100`,
        [req.params.id]
      );

      res.json({
        retailer: {
          ...ret,
          available_credit: creditLimit > 0 ? Math.max(creditLimit - outstanding, 0) : null,
          overdue: Math.min(outstanding, Number(ret.credit_past_due || 0)),
        },
        transactions,
        collections,
      });
    } catch (err) {
      console.error("RETAILER CREDIT DETAIL ERROR:", err);
      res.status(500).json({ error: "Failed to fetch retailer credit detail" });
    }
  });

  /* =====================================================
     GET /retailer/:id/ledger — full transaction ledger
  ===================================================== */

  router.get("/retailer/:id/ledger", async (req, res) => {
    try {
      const [retRows] = await pool.query(
        "SELECT id FROM retailers WHERE id=?",
        [req.params.id]
      );

      if (!retRows.length) {
        return res.status(404).json({ error: "Retailer not found" });
      }

      const [rows] = await pool.query(
        `SELECT * FROM retailer_credit_transactions
         WHERE retailer_id = ?
         ORDER BY created_at DESC, id DESC`,
        [req.params.id]
      );

      res.json(rows);
    } catch (err) {
      console.error("GET CREDIT LEDGER ERROR:", err);
      res.status(500).json({ error: "Failed to fetch credit ledger" });
    }
  });

  /* =====================================================
     POST /retailer/:id/adjust — admin adjustment
  ===================================================== */

  router.post("/retailer/:id/adjust", async (req, res) => {
    const connection = await pool.getConnection();

    try {
      const { amount, notes, due_date } = req.body;

      const delta = Number(amount);

      if (!delta || !Number.isFinite(delta)) {
        return res.status(400).json({ error: "A valid non-zero amount is required" });
      }

      await connection.beginTransaction();

      const [retRows] = await connection.query(
        "SELECT id, outstanding_balance FROM retailers WHERE id=? FOR UPDATE",
        [req.params.id]
      );

      if (!retRows.length) {
        await connection.rollback();
        return res.status(404).json({ error: "Retailer not found" });
      }

      const ret = retRows[0];
      const newBalance = Number(ret.outstanding_balance || 0) + delta;

      if (newBalance < 0) {
        await connection.rollback();
        return res.status(400).json({
          error: `Adjustment would set outstanding below zero (current: ₹${ret.outstanding_balance})`,
        });
      }

      await connection.query(
        `INSERT INTO retailer_credit_transactions
         (retailer_id, transaction_type, amount, balance_after, due_date, notes, created_by)
         VALUES (?, 'ADJUSTMENT', ?, ?, ?, ?, ?)`,
        [
          req.params.id,
          delta,
          newBalance,
          due_date || null,
          notes || "Manual adjustment",
          req.user.id,
        ]
      );

      await connection.query(
        "UPDATE retailers SET outstanding_balance=? WHERE id=?",
        [newBalance, req.params.id]
      );

      await connection.commit();

      res.json({ success: true, outstanding_balance: newBalance });
    } catch (err) {
      await connection.rollback();
      console.error("CREDIT ADJUSTMENT ERROR:", err);
      res.status(500).json({ error: "Failed to apply adjustment" });
    } finally {
      connection.release();
    }
  });

  /* =====================================================
     POST /retailer/:id/collect — record collection
  ===================================================== */

  router.post("/retailer/:id/collect", async (req, res) => {
    const connection = await pool.getConnection();

    try {
      const { amount, payment_method, reference_number, collection_date, notes } = req.body;

      const paymentAmount = Number(amount);

      if (!paymentAmount || paymentAmount <= 0) {
        return res.status(400).json({ error: "Collection amount must be greater than zero" });
      }

      const validMethods = ["cash", "upi", "bank_transfer", "cheque", "razorpay"];
      if (payment_method && !validMethods.includes(payment_method)) {
        return res.status(400).json({ error: `Invalid payment method. Must be one of: ${validMethods.join(", ")}` });
      }

      await connection.beginTransaction();

      const [retRows] = await connection.query(
        "SELECT id, name, outstanding_balance FROM retailers WHERE id=? FOR UPDATE",
        [req.params.id]
      );

      if (!retRows.length) {
        await connection.rollback();
        return res.status(404).json({ error: "Retailer not found" });
      }

      const ret = retRows[0];

      if (paymentAmount > Number(ret.outstanding_balance || 0)) {
        await connection.rollback();
        return res.status(400).json({
          error: `Collection exceeds outstanding balance (₹${Number(ret.outstanding_balance || 0).toFixed(2)} remaining)`,
        });
      }

      const [collectionResult] = await connection.query(
        `INSERT INTO collections
         (collection_number, retailer_id, amount, payment_method, reference_number, collection_date, notes, collected_by, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed')`,
        [
          `COL-PENDING-${Date.now()}`,
          req.params.id,
          paymentAmount,
          payment_method || "cash",
          reference_number || null,
          collection_date || null,
          notes || null,
          req.user.id,
        ]
      );

      const collectionId = collectionResult.insertId;
      const collectionNumber = `COL-${String(collectionId).padStart(6, "0")}`;

      await connection.query(
        "UPDATE collections SET collection_number=? WHERE id=?",
        [collectionNumber, collectionId]
      );

      const newBalance = Number(ret.outstanding_balance || 0) - paymentAmount;

      await connection.query(
        `INSERT INTO retailer_credit_transactions
         (retailer_id, order_id, transaction_type, amount, balance_after, notes, created_by)
         VALUES (?, NULL, 'PAYMENT', ?, ?, ?, ?)`,
        [
          req.params.id,
          paymentAmount,
          newBalance,
          `Collection ${collectionNumber}`,
          req.user.id,
        ]
      );

      await connection.query(
        "UPDATE retailers SET outstanding_balance=? WHERE id=?",
        [newBalance, req.params.id]
      );

      await connection.commit();

      res.status(201).json({
        success: true,
        collection_number: collectionNumber,
        outstanding_balance: newBalance,
      });
    } catch (err) {
      await connection.rollback();
      console.error("COLLECT CREDIT ERROR:", err);
      res.status(500).json({ error: "Failed to record collection" });
    } finally {
      connection.release();
    }
  });

  /* =====================================================
     REGISTER ROUTER
  ===================================================== */

  app.use("/api/credit", authRequired, adminOnly, router);
}