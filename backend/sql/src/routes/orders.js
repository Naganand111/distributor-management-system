import { Router } from "express";
import pool from "../config/db.js";
import { authRequired } from "../config/authMiddleware.js";
import PDFDocument from "pdfkit";
import {
  amountsFromOrder,
  orderTotalsPayload,
  isValidOrderId,
  APPLIED_GST_PERCENT,
  ORDER_GST_RATE,
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  TOTALS_BASIS,
} from "../../../utils/orderTotals.js";

/**
 * ORDER LIST RESPONSE CONTRACT
 * ----------------------------
 * `GET /api/orders` (admin), `GET /api/orders/mine` and `GET /api/orders/my-orders`
 * return an OBJECT, not a bare array:
 *
 *   {
 *     "orders":     [ { ...order columns, subtotal, discount, taxable_amount,
 *                        gst, grand_total, amount_due, gst_rate,
 *                        totals_basis, is_legacy_totals } ],
 *     "pagination": { "page", "limit", "total", "total_pages" }
 *   }
 *
 * Pagination metadata cannot be carried on a bare JSON array, so the object
 * form is the default. Clients that still expect an array can ask for it
 * explicitly with `?format=array`, which returns the same rows as a plain
 * array (no pagination block) and leaves the paginated default untouched.
 *
 * `totals_basis` is `contract` for orders created under the current money
 * rules and a legacy label for historical orders, whose stored figures are
 * reported as recorded rather than recalculated.
 */
const router = Router();

/** True when the caller explicitly asked for the pre-pagination array shape. */
function wantsArrayShape(query) {
  return String(query.format || "").toLowerCase() === "array";
}

/* ---------------- LIST HELPERS ---------------- */

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;
const MAX_PAGE = 100000;

const ORDER_SORTS = {
  newest: "o.created_at DESC, o.id DESC",
  oldest: "o.created_at ASC, o.id ASC",
  amount_high: "o.total_amount DESC, o.id DESC",
  amount_low: "o.total_amount ASC, o.id ASC",
};

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse and clamp `page` / `limit`.
 * @returns {{ok: true, page: number, limit: number} | {ok: false, error: string}}
 */
function parsePaging(query) {
  const rawPage = query.page == null || query.page === "" ? 1 : Number(query.page);
  const rawLimit =
    query.limit == null || query.limit === "" ? DEFAULT_LIMIT : Number(query.limit);

  if (!Number.isInteger(rawPage) || rawPage < 1 || rawPage > MAX_PAGE) {
    return { ok: false, error: `Invalid page. Use an integer between 1 and ${MAX_PAGE}.` };
  }
  if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > MAX_LIMIT) {
    return { ok: false, error: `Invalid limit. Use an integer between 1 and ${MAX_LIMIT}.` };
  }
  return { ok: true, page: rawPage, limit: rawLimit };
}

/**
 * Validate list filters shared by the admin and customer order lists.
 * Every value is either whitelisted or bound as a parameter â€” never
 * interpolated into SQL.
 */
function parseFilters(query) {
  const where = [];
  const params = [];

  if (query.status != null && query.status !== "") {
    const status = String(query.status).toLowerCase();
    if (!ORDER_STATUSES.includes(status)) {
      return { ok: false, error: "Invalid status filter" };
    }
    where.push("o.status = ?");
    params.push(status);
  }

  if (query.payment_status != null && query.payment_status !== "") {
    const paymentStatus = String(query.payment_status).toLowerCase();
    if (!PAYMENT_STATUSES.includes(paymentStatus)) {
      return { ok: false, error: "Invalid payment status filter" };
    }
    where.push("o.payment_status = ?");
    params.push(paymentStatus);
  }

  if (query.from != null && query.from !== "") {
    if (!isoDate.test(String(query.from))) {
      return { ok: false, error: "Invalid from date. Use YYYY-MM-DD." };
    }
    where.push("o.created_at >= ?");
    params.push(`${query.from} 00:00:00`);
  }

  if (query.to != null && query.to !== "") {
    if (!isoDate.test(String(query.to))) {
      return { ok: false, error: "Invalid to date. Use YYYY-MM-DD." };
    }
    where.push("o.created_at <= ?");
    params.push(`${query.to} 23:59:59`);
  }

  if (query.from && query.to && String(query.from) > String(query.to)) {
    return { ok: false, error: "from date must be on or before to date" };
  }

  if (query.q != null && String(query.q).trim() !== "") {
    const term = String(query.q).trim().slice(0, 100);
    // A bare number searches by order id; anything else by customer name.
    if (/^\d+$/.test(term)) {
      where.push("o.id = ?");
      params.push(Number(term));
    } else {
      where.push("o.customer_name LIKE ?");
      params.push(`%${term}%`);
    }
  }

  const orderBy = ORDER_SORTS[String(query.sort || "newest").toLowerCase()] || ORDER_SORTS.newest;

  return { ok: true, where, params, orderBy };
}

/** Run a validated, paginated order list scoped to `ownerClause`. */
async function listOrders(req, res, { ownerClause, ownerParams, columns }) {
  const paging = parsePaging(req.query);
  if (!paging.ok) return res.status(400).json({ error: paging.error });

  const filters = parseFilters(req.query);
  if (!filters.ok) return res.status(400).json({ error: filters.error });

  const where = [...ownerClause, ...filters.where];
  const params = [...ownerParams, ...filters.params];
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  try {
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM orders o ${whereSql}`,
      params
    );

    const [rows] = await pool.query(
      `SELECT ${columns}
         FROM orders o
         LEFT JOIN users u ON u.id = o.user_id
         ${whereSql}
         ORDER BY ${filters.orderBy}
         LIMIT ? OFFSET ?`,
      [...params, paging.limit, (paging.page - 1) * paging.limit]
    );

    const orders = rows.map((row) => ({ ...row, ...orderTotalsPayload(row) }));

    // Backward-compatible shape for clients written before pagination existed.
    if (wantsArrayShape(req.query)) {
      return res.json(orders);
    }

    res.json({
      orders,
      pagination: {
        page: paging.page,
        limit: paging.limit,
        total: Number(total),
        total_pages: Math.max(1, Math.ceil(Number(total) / paging.limit)),
      },
    });
  } catch (err) {
    console.error("ORDER LIST ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
}

const LIST_COLUMNS = `o.id, o.user_id, o.retailer_id, o.customer_name, o.salesman,
  o.status, o.payment_status, o.payment_method,
  o.total_amount, o.discount, o.gst, o.paid_amount,
  o.created_at, o.shipping_name, o.shipping_city, o.shipping_state, o.shipping_pincode,
  COALESCE(u.name, o.customer_name) AS customer`;

/* ---------------- MY ORDERS ---------------- */
router.get("/mine", authRequired, async (req, res) => {
  await listOrders(req, res, {
    ownerClause: ["o.user_id = ?"],
    ownerParams: [req.user.id],
    columns: LIST_COLUMNS,
  });
});

/* ---------------- MY ORDERS (customer panel, with invoice_no) ---------------- */
router.get("/my-orders", authRequired, async (req, res) => {
  const paging = parsePaging(req.query);
  if (!paging.ok) return res.status(400).json({ error: paging.error });

  const filters = parseFilters(req.query);
  if (!filters.ok) return res.status(400).json({ error: filters.error });

  const where = ["o.user_id = ?", ...filters.where];
  const params = [req.user.id, ...filters.params];
  const whereSql = `WHERE ${where.join(" AND ")}`;

  try {
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM orders o ${whereSql}`,
      params
    );

    const [rows] = await pool.query(
      `SELECT
         o.id, o.user_id, o.retailer_id, o.customer_name, o.salesman,
         o.status, o.payment_status, o.payment_method,
         o.total_amount, o.discount, o.gst, o.paid_amount, o.created_at,
         (SELECT invoice_no FROM invoices i WHERE i.order_id=o.id) AS invoice_no,
         (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id=o.id) AS items_count
       FROM orders o
       ${whereSql}
       ORDER BY ${filters.orderBy}
       LIMIT ? OFFSET ?`,
      [...params, paging.limit, (paging.page - 1) * paging.limit]
    );

    const orders = rows.map((row) => ({ ...row, ...orderTotalsPayload(row) }));

    if (wantsArrayShape(req.query)) {
      return res.json(orders);
    }

    res.json({
      orders,
      pagination: {
        page: paging.page,
        limit: paging.limit,
        total: Number(total),
        total_pages: Math.max(1, Math.ceil(Number(total) / paging.limit)),
      },
    });
  } catch (err) {
    console.error("MY ORDERS ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ---------------- ADMIN: ALL ORDERS ---------------- */
router.get("/", authRequired, async (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Access denied" });
  }

  await listOrders(req, res, {
    ownerClause: [],
    ownerParams: [],
    columns: LIST_COLUMNS,
  });
});

/* ---------------- VIEW ORDER ---------------- */
router.get("/:id", authRequired, async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidOrderId(id)) {
      return res.status(400).json({ error: "Invalid order id" });
    }

    const [orderRows] = await pool.query(
      `SELECT o.*, COALESCE(u.name, o.customer_name) AS customer
       FROM orders o
       LEFT JOIN users u ON u.id = o.user_id
       WHERE o.id = ?`,
      [id]
    );

    if (!orderRows.length) {
      return res.status(404).json({ error: "Order not found" });
    }

    const order = orderRows[0];

    // \u{1F510} SECURITY \u2014 ownership is enforced in SQL semantics; the
    // comparison is string-normalised because the JWT id may be a string.
    if (req.user.role !== "admin" && String(order.user_id) !== String(req.user.id)) {
      return res.status(403).json({ error: "Access denied" });
    }

    const [items] = await pool.query(
      `SELECT oi.*, COALESCE(p.name, CONCAT('Product #', oi.product_id)) AS productName,
              p.sku, p.gst_percent
       FROM order_items oi
       LEFT JOIN products p ON oi.product_id = p.id
       WHERE oi.order_id = ?
       ORDER BY oi.id ASC`,
      [id]
    );

    const [history] = await pool.query(
      `SELECT h.id, h.status, h.prev_status, h.note, h.created_at, u.name AS changed_by_name
       FROM order_status_history h
       LEFT JOIN users u ON h.changed_by = u.id
       WHERE h.order_id = ?
       ORDER BY h.id ASC`,
      [id]
    );

    const [invoiceRows] = await pool.query(
      "SELECT * FROM invoices WHERE order_id = ?",
      [id]
    );

    res.json({
      order: { ...order, ...orderTotalsPayload(order) },
      items,
      history,
      invoice: invoiceRows[0] || null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ---------------- INVOICE ----------------
   Authentication is via the Authorization header ONLY.
   JWTs are NOT accepted in query parameters, URL fragments or filenames.
--------------------------------------------- */
router.get("/:id/invoice", authRequired, async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidOrderId(id)) {
      return res.status(400).json({ error: "Invalid order id" });
    }

    const decoded = req.user;

    let query = `
      SELECT o.*, COALESCE(u.name, o.customer_name, 'Customer') AS customer, u.email
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      WHERE o.id = ?
    `;
    const params = [id];
    if (decoded.role !== "admin") {
      query += " AND o.user_id = ?";
      params.push(decoded.id);
    }

    const [orderRows] = await pool.query(query, params);

    if (!orderRows.length) {
      return res.status(404).json({ error: "Order not found" });
    }

    const order = orderRows[0];

    const [items] = await pool.query(
      `SELECT oi.*, COALESCE(p.name, CONCAT('Product #', oi.product_id)) AS productName
       FROM order_items oi
       LEFT JOIN products p ON oi.product_id = p.id
       WHERE oi.order_id = ?`,
      [id]
    );

    const [invRows] = await pool.query(
      `SELECT * FROM invoices WHERE order_id = ?`,
      [id]
    );
    const invoice = invRows[0] || null;
    const invoiceNo = invoice?.invoice_no || `INV-${String(order.id).padStart(6, "0")}`;

    // Canonical money contract: total_amount is the line-item subtotal.
    const totals = amountsFromOrder(order);

    const doc = new PDFDocument({ margin: 50, size: "A4" });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=${invoiceNo}.pdf`
    );

    doc.pipe(res);

    /* Header */
    doc.fontSize(22).fillColor("#1d1d1f").text("NP STORE", { align: "center" });
    doc.fontSize(10).fillColor("#6e6e73").text("TAX INVOICE", {
      align: "center",
    });
    doc.moveDown();
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor("#cccccc").stroke();
    doc.moveDown();

    /* Meta block */
    doc.fontSize(11).fillColor("#1d1d1f");
    doc.text(`Invoice #: ${invoiceNo}`);
    doc.text(`Order Date: ${new Date(order.created_at).toLocaleDateString("en-IN")}`);
    doc.text(`Customer: ${order.customer}`);
    if (order.email) doc.text(`Email: ${order.email}`);
    if (order.shipping_mobile) doc.text(`Contact: ${order.shipping_mobile}`);
    if (order.shipping_address) {
      const addr = [order.shipping_address, order.shipping_city, order.shipping_state, order.shipping_pincode].filter(Boolean).join(", ");
      doc.text(`Address: ${addr}`);
    }
    doc.text(`Payment Status: ${(order.payment_status || "pending").toUpperCase()}`);
    doc.moveDown();
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor("#cccccc").stroke();
    doc.moveDown();

    /* Items table header */
    const tableTop = doc.y;
    const colX = {
      product: 50,
      qty: 320,
      price: 380,
      total: 470,
    };

    doc.fontSize(10);
    doc.rect(50, doc.y, 495, 20).fill("#0071e3");
    doc.fillColor("#ffffff");
    doc.text("PRODUCT", colX.product + 5, doc.y + 5);
    doc.text("QTY", colX.qty, doc.y + 5);
    doc.text("PRICE", colX.price, doc.y + 5);
    doc.text("TOTAL", colX.total, doc.y + 5);
    doc.fillColor("#1d1d1f");
    doc.moveDown(2.4);

    doc.fontSize(10);
    for (const item of items) {
      const lineTotal = Number(item.price) * Number(item.quantity);
      doc.text(item.productName || `Product #${item.product_id}`, colX.product, doc.y, { width: 260 });
      doc.text(String(item.quantity), colX.qty, doc.y);
      doc.text(`Rs. ${Number(item.price).toFixed(2)}`, colX.price, doc.y);
      doc.text(`Rs. ${lineTotal.toFixed(2)}`, colX.total, doc.y);
      doc.moveDown();
    }

    doc.moveDown();
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor("#cccccc").stroke();
    doc.moveDown();

    /* Totals. The label rate comes from the canonical constant so the
       document can never drift from the rate the order was calculated with. */
    doc.fontSize(11);
    doc.text(`Subtotal:    Rs. ${totals.subtotal.toFixed(2)}`, colX.total, doc.y, { width: 495, align: "right" });
    if (totals.discount > 0) {
      doc.text(`Discount:   -Rs. ${totals.discount.toFixed(2)}`, colX.total, doc.y, { width: 495, align: "right" });
    }
    doc.text(
      `GST (${APPLIED_GST_PERCENT}%):   Rs. ${totals.gst.toFixed(2)}`,
      colX.total,
      doc.y,
      { width: 495, align: "right" }
    );
    doc.font("Helvetica-Bold");
    doc.text(`GRAND TOTAL: Rs. ${totals.grandTotal.toFixed(2)}`, colX.total, doc.y, { width: 495, align: "right" });
    doc.font("Helvetica");
    doc.moveDown(2);

    /* Footer. Historical orders keep their recorded figures; say so rather
       than silently restating them on today's rules. */
    doc.fontSize(9).fillColor("#6e6e73");
    if (totals.basis === TOTALS_BASIS.GST_INCLUDED_IN_TOTAL) {
      doc.text(
        `Recorded under an earlier calculation: the amount above already includes GST of Rs. ${totals.gst.toFixed(2)}.`,
        { align: "center" }
      );
    } else if (totals.basis === TOTALS_BASIS.NO_TAX_RECORDED) {
      doc.text("Recorded before tax was applied to this order; no GST was charged.", {
        align: "center",
      });
    } else if (totals.basis === TOTALS_BASIS.UNCLASSIFIED) {
      doc.text("Recorded with a tax amount that does not match any known calculation basis.", {
        align: "center",
      });
    }
    doc.text("Thank you for shopping with NP Store.", { align: "center" });

    doc.end();
  } catch (err) {
    console.error("INVOICE GENERATION ERROR:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to generate invoice PDF" });
    }
  }
});

export default router;
