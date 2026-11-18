/* =====================================================
   PHASE 9 - GLOBAL SEARCH & DOCUMENTS
   Role-safe: admin searches everything; customers are
   restricted to their own records. Documents (invoices)
   are listed here but downloaded via the existing
   /api/orders/:id/invoice PDF endpoint.
===================================================== */

export default function registerGlobalSearchRoutes(app, pool, authRequired, adminOnly) {
  const adminGuard = [authRequired, adminOnly];

  /* ---- Role-aware global search ---- */
  app.get("/api/global-search", authRequired, async (req, res) => {
    try {
      const q = (req.query.q || "").trim();
      if (!q) return res.json({ query: "", items: [] });
      const like = `%${q}%`;
      const items = [];

      if (req.user.role === "admin") {
        const [orders] = await pool.query(
          `SELECT o.id, 'order' AS type, CONCAT('Order #', o.id) AS title,
                  CONCAT('₹', IFNULL(o.total_amount,0), ' - ', COALESCE(r.name,''), ' (', o.status, ')') AS subtitle
           FROM orders o LEFT JOIN retailers r ON r.id=o.retailer_id
           WHERE CAST(o.id AS CHAR) LIKE ?
           LIMIT 10`, [like]);
        items.push(...orders);

        const [products] = await pool.query(
          `SELECT p.id, 'product' AS type, p.name AS title,
                  CONCAT('SKU: ', p.sku, ' - stock ', p.stock) AS subtitle
           FROM products p
           WHERE p.is_deleted=0 AND (p.name LIKE ? OR p.sku LIKE ?)
           LIMIT 10`, [like, like]);
        items.push(...products);

        const [invoices] = await pool.query(
          `SELECT i.id, 'invoice' AS type, i.invoice_no AS title,
                  CONCAT('Order #', i.order_id, ' ', i.payment_status, ' (₹', IFNULL(i.grand_total,0), ')') AS subtitle,
                  i.order_id AS reference_id
           FROM invoices i
           WHERE i.invoice_no LIKE ?
           LIMIT 10`, [like]);
        items.push(...invoices);

        const [retailers] = await pool.query(
          `SELECT r.id, 'retailer' AS type, r.name AS title,
                  CONCAT('₹', IFNULL(r.outstanding_balance,0), ' outstanding') AS subtitle
           FROM retailers r
           WHERE r.name LIKE ? OR r.mobile LIKE ?
           LIMIT 10`, [like, like]);
        items.push(...retailers);

        const [poses] = await pool.query(
          `SELECT po.id, 'purchase_order' AS type, po.po_number AS title,
                  CONCAT('PO - ', po.status, ' (₹', IFNULL(po.total_amount,0), ')') AS subtitle
           FROM purchase_orders po
           WHERE po.po_number LIKE ?
           LIMIT 10`, [like]);
        items.push(...poses);

        const [suppliers] = await pool.query(
          `SELECT s.id, 'supplier' AS type, s.company_name AS title, s.phone AS subtitle
           FROM suppliers s
           WHERE s.company_name LIKE ?
           LIMIT 10`, [like]);
        items.push(...suppliers);

        const [returns] = await pool.query(
          `SELECT ret.id, 'return' AS type, ret.return_number AS title,
                  CONCAT(ret.status, ' (₹', IFNULL(ret.total_amount,0), ')') AS subtitle
           FROM returns ret
           WHERE ret.return_number LIKE ?
           LIMIT 10`, [like]);
        items.push(...returns);
      } else {
        /* Customer: only their own orders, invoices, returns, payments */
        const [[ret]] = await pool.query(
          "SELECT id FROM retailers WHERE user_id=?", [req.user.id]
        );
        const retailerId = ret?.id || null;

        const [orders] = await pool.query(
          `SELECT o.id, 'order' AS type, CONCAT('Order #', o.id) AS title,
                  CONCAT('₹', IFNULL(o.total_amount,0), ' (', o.status, ')') AS subtitle
           FROM orders o
           WHERE CAST(o.id AS CHAR) LIKE ?
             AND o.retailer_id = ?
           LIMIT 10`, [like, retailerId]);
        items.push(...orders);

        if (retailerId) {
          const [invoices] = await pool.query(
            `SELECT i.id, 'invoice' AS type, i.invoice_no AS title,
                    CONCAT('Order #', i.order_id, ' ', i.payment_status) AS subtitle,
                    i.order_id AS reference_id
             FROM invoices i
             JOIN orders o ON o.id = i.order_id
             WHERE i.invoice_no LIKE ? AND o.retailer_id = ?
             LIMIT 10`, [like, retailerId]);
          items.push(...invoices);

          const [returns] = await pool.query(
            `SELECT ret.id, 'return' AS type, ret.return_number AS title,
                    CONCAT(ret.status, ' (₹', IFNULL(ret.total_amount,0), ')') AS subtitle
             FROM returns ret
             WHERE ret.return_number LIKE ? AND ret.retailer_id = ?
             LIMIT 10`, [like, retailerId]);
          items.push(...returns);
        }
      }

      res.json({ query: q, items });
    } catch (err) {
      console.error("GLOBAL SEARCH ERROR:", err);
      res.status(500).json({ error: "Server error" });
    }
  });

  /* ---- Documents: role-safe list of invoices + download URL ---- */
  app.get("/api/documents", authRequired, async (req, res) => {
    try {
      if (req.user.role === "admin") {
        const [rows] = await pool.query(
          `SELECT i.id, i.invoice_no, i.order_id, i.invoice_date, i.payment_status,
                  i.grand_total, r.name AS retailer_name
           FROM invoices i
           LEFT JOIN orders o ON o.id = i.order_id
           LEFT JOIN retailers r ON r.id = o.retailer_id
           ORDER BY i.invoice_date DESC
           LIMIT 200`
        );
        const docs = rows.map((r) => ({
          ...r,
          type: "invoice",
          downloadUrl: `/api/orders/${r.order_id}/invoice`,
        }));
        return res.json({ data: docs });
      }

      const [[ret]] = await pool.query(
        "SELECT id FROM retailers WHERE user_id=?", [req.user.id]
      );
      if (!ret) return res.json({ data: [] });
      const [rows] = await pool.query(
        `SELECT i.id, i.invoice_no, i.order_id, i.invoice_date, i.payment_status,
                i.grand_total
         FROM invoices i
         JOIN orders o ON o.id = i.order_id
         WHERE o.retailer_id = ?
         ORDER BY i.invoice_date DESC
         LIMIT 200`, [ret.id]
      );
      const docs = rows.map((r) => ({
        ...r,
        type: "invoice",
        downloadUrl: `/api/orders/${r.order_id}/invoice`,
      }));
      res.json({ data: docs });
    } catch (err) {
      console.error("DOCUMENTS ERROR:", err);
      res.status(500).json({ error: "Server error" });
    }
  });
}
