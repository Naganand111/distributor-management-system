import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import multer from "multer";
import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import rateLimit from "express-rate-limit";
import { JWT_SECRET } from "./sql/src/config/jwt.js";
import { setAuthPool } from "./sql/src/config/authMiddleware.js";

// ROUTES
import usersRoutes from "./sql/src/routes/users.js";
import ordersRoutes from "./sql/src/routes/orders.js";
import registerProductRoutes from "./routes/products.js";
import registerReportRoutes from "./routes/reports.js";
import registerDmsRoutes from "./routes/dms.js";
import registerCustomerRoutes from "./routes/customer.js";
import registerCustomerAiRoutes from "./routes/customerAi.js";
import registerDmsAdvancedRoutes from "./routes/dmsAdvanced.js";
import registerNotificationRoutes from "./routes/notifications.js";
import registerActivityLogRoutes from "./routes/activityLogs.js";
import registerAnalyticsRoutes from "./routes/analytics.js";
import registerReorderRoutes from "./routes/reorder.js";
import registerGlobalSearchRoutes from "./routes/globalSearch.js";
import registerAiRoutes from "./routes/ai.js";
import registerProfitRoutes from "./routes/profit.js";
import registerPromotionsRoutes from "./routes/promotions.js";
import registerCreditRoutes from "./routes/credit.js";
import registerDeliveryRoutes from "./routes/deliveries.js";
import registerLoyaltyRoutes from "./routes/loyalty.js";
import registerWarehouseRoutes from "./routes/warehouses.js";
import registerBarcodeRoutes from "./routes/barcode.js";
import registerSalesRoutes from "./routes/salesRoutes.js";
import registerCompanyRoutes from "./routes/companies.js";
import registerSecurityRoutes from "./routes/security.js";
import registerAdvancedReportRoutes from "./routes/advancedReports.js";
import { logActivity } from "./utils/activityLogger.js";
import { createNotification } from "./utils/notificationService.js";
import {
  amountsFromOrder,
  computeOrderTotals,
  isValidOrderId,
  normalizeOrderLines,
  paymentStatusFor,
  roundMoney,
  APPLIED_GST_PERCENT,
  ORDER_GST_RATE,
  MAX_ITEM_QUANTITY,
  MAX_ORDER_SUBTOTAL,
  ORDER_STATUSES,
  STATUS_TRANSITIONS,
  CANCELLABLE_STATUSES,
  OrderValidationError,
  OrderForbiddenError,
} from "./utils/orderTotals.js";
import {
  isValidGatewayId,
  paiseToRupees,
  resolveGateway,
  rupeesToPaise,
  safeGatewayError,
  verifyGatewaySignature,
} from "./utils/paymentGateway.js";

const app = express();

if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

/* ---------------- SECURITY HEADERS ---------------- */

app.use(helmet());

/* ---------------- CORS ---------------- */

const corsOrigins =
  (process.env.CORS_ORIGIN || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const corsOptions = {
  origin(origin, cb) {
    // Allow non-browser clients (curl, server-to-server) and same-origin requests.
    if (!origin) return cb(null, true);

    // No origins configured -> deny browser cross-origin calls.
    if (corsOrigins.length === 0) return cb(null, false);

    // Wildcard is only allowed outside production (explicit development setups).
    if (corsOrigins.includes("*")) {
      return process.env.NODE_ENV === "production"
        ? cb(null, false)
        : cb(null, true);
    }

    if (corsOrigins.includes(origin)) return cb(null, true);

    return cb(null, false);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
};

app.use(cors(corsOptions));

app.use(express.json({ limit: "1mb" }));

/* ---------------- RATE LIMITING ---------------- */

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: "Too many attempts. Please try again in 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: "Too many password reset requests. Please try again in 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

const otpVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: "Too many verification attempts. Please try again in 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

/* ---------------- STATIC ---------------- */

const UPLOAD_DIR = (process.env.UPLOAD_DIR || "uploads").replace(/\/+$/, "");
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

app.use(
  "/uploads",
  express.static(UPLOAD_DIR, {
    dotfiles: "deny",
    index: false,
    redirect: false,
    setHeaders: (res) => {
      res.setHeader("X-Content-Type-Options", "nosniff");
      // Uploaded product images are intentionally public assets that the
      // frontend may serve from a different origin (dev: 3000 -> 5000).
      // Helmet sets Cross-Origin-Resource-Policy: same-origin globally; relax
      // it to cross-origin for THIS public static mount only so browsers can
      // display these images cross-origin. All other routes keep same-origin.
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    },
  })
);

/* ---------------- DATABASE ---------------- */

function requireDbEnv(name) {
  const value = process.env[name];
  if (!value || !String(value).trim()) {
    throw new Error(
      `Required environment variable ${name} is not set. Check backend/.env`
    );
  }
  return value;
}

const pool = mysql.createPool({
  host: requireDbEnv("DB_HOST"),
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
  user: requireDbEnv("DB_USER"),
  password: process.env.DB_PASSWORD ?? "",
  database: requireDbEnv("DB_NAME"),
  waitForConnections: true,
  connectionLimit: 10,
  connectTimeout: 10000,
});

/* ---------------- AUTH MIDDLEWARE ---------------- */

/**
 * Access tokens are stored server-side as SHA-256 digests so that a database
 * leak can never yield a replayable token, and so that logout / admin session
 * revocation actually invalidates a token instead of only flipping a flag.
 */
const hashToken = (token) =>
  crypto.createHash("sha256").update(String(token)).digest("hex");

const authRequired = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];

    if (!token) {
      return res.status(401).json({
        error: "No token",
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET);

    // Session must still be live. This makes logout, "revoke" and
    // "revoke all" effective instead of cosmetic.
    const [sessions] = await pool.query(
      "SELECT id FROM user_sessions WHERE token=? AND is_active=1 LIMIT 1",
      [hashToken(token)]
    );

    if (sessions.length === 0) {
      return res.status(401).json({
        error: "Session expired or revoked",
      });
    }

    req.user = decoded;
    req.sessionId = sessions[0].id;

    next();
  } catch (err) {
    return res.status(401).json({
      error: "Invalid token",
    });
  }
};

const adminOnly = (req, res, next) => {
  if (req.user?.role !== "admin") {
    return res.status(403).json({
      error: "Admin access only",
    });
  }

  next();
};

/* ---------------- BASIC ROUTES ---------------- */

// The legacy sql/src routers reuse their own auth middleware; give them this
// pool so session revocation is enforced on /api/orders and /api/users too.
setAuthPool(pool);

app.use("/api/users", usersRoutes);
app.use("/api/orders", ordersRoutes);
// Legacy convenience redirect. Query strings (including any ?token=) are
// deliberately dropped: invoice auth is via the Authorization header only.
app.get("/orders/:id/invoice", (req, res) => {
  res.redirect(`/api/orders/${req.params.id}/invoice`);
});

/* =====================================================
   ORDER CREATION
===================================================== */

/**
 * Promotion discount resolution — the existing DMS promotion rules, applied to
 * server-calculated line prices and the server-calculated subtotal.
 *
 * The cart, the base amount and every price used below come from the database;
 * nothing here reads a client-supplied amount.
 */
async function resolvePromotionDiscount({
  connection,
  code,
  pricedLines,
  subtotal,
}) {
  if (!code) return { id: null, discount: 0 };

  const [[promo]] = await connection.query(
    `SELECT * FROM promotions
      WHERE code=? AND status='active'
        AND (start_date IS NULL OR start_date<=CURDATE())
        AND (end_date IS NULL OR end_date>=CURDATE())`,
    [String(code)]
  );

  if (!promo) throw new OrderValidationError("Invalid or expired promotion code");

  if (promo.usage_limit && Number(promo.used_count) >= Number(promo.usage_limit)) {
    throw new OrderValidationError("Promotion usage limit reached");
  }

  if (promo.min_order_value && subtotal < Number(promo.min_order_value)) {
    throw new OrderValidationError(
      `Minimum order value ₹${promo.min_order_value} required for this promotion`
    );
  }

  if (
    promo.product_id &&
    !pricedLines.some((l) => l.productId === Number(promo.product_id))
  ) {
    throw new OrderValidationError(
      "This promotion applies to a specific product not in your cart"
    );
  }

  if (promo.category_id) {
    const [catProducts] = await connection.query(
      "SELECT id FROM products WHERE category_id=? AND id IN (?)",
      [promo.category_id, pricedLines.map((l) => l.productId)]
    );
    if (catProducts.length === 0) {
      throw new OrderValidationError(
        "This promotion does not apply to any product in your cart"
      );
    }
  }

  const totalQty = pricedLines.reduce((s, l) => s + l.quantity, 0);
  let computed = 0;

  if (promo.type === "percentage" || promo.type === "product" || promo.type === "category") {
    computed = (subtotal * Number(promo.value)) / 100;
  } else if (promo.type === "fixed") {
    computed = Number(promo.value);
  } else if (promo.type === "min_order") {
    computed = subtotal >= Number(promo.min_order_value) ? Number(promo.value) : 0;
  } else if (promo.type === "quantity") {
    const bundle =
      promo.buy_qty && promo.buy_qty > 0 ? Math.floor(totalQty / promo.buy_qty) : 0;
    if (bundle > 0) {
      const highest = pricedLines.reduce((m, l) => Math.max(m, l.price), 0);
      computed = bundle * (promo.get_qty || 0) * highest;
    }
  } else if (promo.type === "buy_x_get_y") {
    const eligible = pricedLines.find(
      (l) => l.productId === Number(promo.product_id)
    );
    if (eligible) {
      const bundle = Math.floor(eligible.quantity / (promo.buy_qty || 1));
      computed = bundle * (promo.get_qty || 0) * eligible.price;
    }
  }

  return {
    id: promo.id,
    discount: roundMoney(Math.min(Math.max(0, computed), subtotal)),
  };
}

const ORDER_PAYMENT_METHODS = new Set(["cash", "online"]);

app.post("/api/orders", authRequired, async (req, res) => {
  let connection = null;

  try {
    const {
      items,
      retailer_id,
      salesman,
      notes,
      shipping,
      payment_method,
      promotion_code,
      // Accepted for backward compatibility with the existing checkout
      // payload, but deliberately IGNORED: every money value below is
      // recalculated from the database.
      total_amount: _ignoredTotal,
      gst: _ignoredGst,
      discount: requestedDiscount,
      paid_amount: _ignoredPaid,
      payment_status: _ignoredPaymentStatus,
    } = req.body;

    /* ---------------------------------------------------------------
       1. CART SHAPE  (no database work yet)
       Client-supplied prices are dropped here: they are never trusted.
    ----------------------------------------------------------------*/
    const lines = normalizeOrderLines(items);

    const method =
      payment_method == null || payment_method === ""
        ? "cash"
        : String(payment_method).toLowerCase();

    if (!ORDER_PAYMENT_METHODS.has(method)) {
      return res
        .status(400)
        .json({ error: "Invalid payment method. Use 'cash' or 'online'." });
    }

    /* ---------------------------------------------------------------
       2. AUTHENTICATED ACTOR  (identity is never taken from the body)
    ----------------------------------------------------------------*/
    connection = await pool.getConnection();

    const [userRows] = await connection.query(
      "SELECT id, name, company_id, branch_id FROM users WHERE id=?",
      [req.user.id]
    );

    if (!userRows.length) {
      return res.status(401).json({ error: "Account no longer exists" });
    }

    const customerName = userRows[0].name || "";
    const customerCompanyId = userRows[0].company_id || 1;
    const customerBranchId = userRows[0].branch_id || 1;

    // A customer may only attach an order to their own retailer record.
    let effectiveRetailerId = null;
    if (retailer_id != null && retailer_id !== "") {
      if (!isValidOrderId(retailer_id)) {
        return res.status(400).json({ error: "Invalid retailer id" });
      }
      const [[retailer]] = await connection.query(
        "SELECT id, user_id, status FROM retailers WHERE id=?",
        [retailer_id]
      );
      if (!retailer) {
        return res.status(404).json({ error: "Retailer not found" });
      }
      if (
        req.user.role !== "admin" &&
        String(retailer.user_id) !== String(req.user.id)
      ) {
        return res.status(403).json({
          error: "You can only create orders for your own account",
        });
      }
      effectiveRetailerId = retailer.id;
    }

    const ship = shipping && typeof shipping === "object" ? shipping : {};

    await connection.beginTransaction();

    /* ---------------------------------------------------------------
       3. LOCK + PRICE EVERY LINE FROM THE DATABASE
       One SELECT ... FOR UPDATE over every product id (ascending, so
       concurrent carts that share products lock in the same order and
       cannot deadlock), then stock/existence/status validation.
    ----------------------------------------------------------------*/
    const productIds = lines.map((l) => l.productId);
    const [productRows] = await connection.query(
      `SELECT id, name, sku, price, stock, gst_percent, status, is_deleted
         FROM products
        WHERE id IN (?)
        ORDER BY id
        FOR UPDATE`,
      [productIds]
    );

    const products = new Map(productRows.map((p) => [Number(p.id), p]));

    // price/qty per line, from the database only.
    const pricedLines = [];
    let subtotal = 0;

    for (const line of lines) {
      const product = products.get(line.productId);

      if (!product || Number(product.is_deleted) === 1) {
        throw new OrderValidationError(`Product ${line.productId} not found`);
      }

      if (product.status !== "active") {
        throw new OrderValidationError(
          `Product ${line.productId} is not available for purchase`
        );
      }

      const price = roundMoney(product.price);
      if (!Number.isFinite(price) || price < 0) {
        throw new OrderValidationError(
          `Product ${line.productId} has an invalid price`
        );
      }

      const stock = Number(product.stock || 0);
      if (line.quantity > stock) {
        throw new OrderValidationError(
          `Insufficient stock for product ${line.productId} (available: ${stock})`
        );
      }

      const lineTotal = roundMoney(price * line.quantity);
      subtotal = roundMoney(subtotal + lineTotal);

      pricedLines.push({
        productId: line.productId,
        quantity: line.quantity,
        price,
        lineTotal,
        name: product.name,
        sku: product.sku,
        gstPercent: roundMoney(product.gst_percent || 0),
        stock,
      });
    }

    if (subtotal > MAX_ORDER_SUBTOTAL) {
      throw new OrderValidationError(
        "Order total exceeds the maximum allowed amount"
      );
    }

    /* ---------------------------------------------------------------
       4. DISCOUNT  (existing promotion rules only)
       A customer cannot apply their own discount; only an admin may enter
       a manual discount, and it is validated against the server-side
       subtotal - a discount larger than the subtotal is rejected outright
       rather than silently clamped, so the stored figures always describe
       what was actually charged.
    ----------------------------------------------------------------*/
    let manualDiscount = 0;
    if (requestedDiscount != null && Number(requestedDiscount) !== 0) {
      if (req.user.role !== "admin") {
        throw new OrderForbiddenError(
          "Discounts can only be applied by an administrator or a valid promotion code"
        );
      }
      manualDiscount = Number(requestedDiscount);
      if (!Number.isFinite(manualDiscount) || manualDiscount < 0) {
        throw new OrderValidationError("Invalid discount amount");
      }
      if (manualDiscount > subtotal) {
        throw new OrderValidationError(
          "Discount cannot be greater than the order subtotal"
        );
      }
    }

    const promo = await resolvePromotionDiscount({
      connection,
      code: promotion_code,
      pricedLines,
      subtotal,
    });

    const totals = computeOrderTotals(subtotal, manualDiscount + promo.discount);

    /* ---------------------------------------------------------------
       5. INSERT ORDER
       paid_amount starts at 0 and payment_status is derived: a request
       body can never mark an order as paid.
    ----------------------------------------------------------------*/
    const [orderRes] = await connection.query(
      `INSERT INTO orders
      (
        user_id,
        customer_name,
        total_amount,
        discount,
        paid_amount,
        gst,
        status,
        payment_status,
        retailer_id,
        salesman,
        notes,
        shipping_name,
        shipping_mobile,
        shipping_address,
        shipping_city,
        shipping_state,
        shipping_pincode,
        payment_method,
        company_id,
        branch_id
      )
      VALUES (?, ?, ?, ?, 0, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.id,
        customerName,
        totals.subtotal,
        totals.discount,
        totals.gst,
        method === "online" ? "pending" : "unpaid",
        effectiveRetailerId,
        salesman ? String(salesman).slice(0, 100) : null,
        notes ? String(notes).slice(0, 255) : null,
        ship.name ? String(ship.name).slice(0, 150) : null,
        ship.mobile ? String(ship.mobile).slice(0, 20) : null,
        ship.address ? String(ship.address).slice(0, 255) : null,
        ship.city ? String(ship.city).slice(0, 100) : null,
        ship.state ? String(ship.state).slice(0, 100) : null,
        ship.pincode ? String(ship.pincode).slice(0, 20) : null,
        method,
        customerCompanyId,
        customerBranchId,
      ]
    );

    const orderId = orderRes.insertId;

    /* ---------------------------------------------------------------
       6. LINE ITEMS + STOCK MOVEMENT (same transaction, rows locked)
    ----------------------------------------------------------------*/
    for (const line of pricedLines) {
      await connection.query(
        `INSERT INTO order_items (order_id, product_id, quantity, price)
         VALUES (?, ?, ?, ?)`,
        [orderId, line.productId, line.quantity, line.price]
      );

      const newStock = line.stock - line.quantity;

      await connection.query("UPDATE products SET stock=? WHERE id=?", [
        newStock,
        line.productId,
      ]);

      await connection.query(
        `INSERT INTO inventory_movements
        (
          product_id,
          movement_type,
          quantity,
          prev_stock,
          new_stock,
          reference_type,
          reference_id,
          reason,
          created_by
        )
        VALUES (?, 'OUT', ?, ?, ?, 'ORDER', ?, 'Sales order', ?)`,
        [line.productId, line.quantity, line.stock, newStock, orderId, req.user.id]
      );
    }

    await connection.query(
      `INSERT INTO order_status_history (order_id, status, note, changed_by)
       VALUES (?, 'pending', 'Order placed', ?)`,
      [orderId, req.user.id]
    );

    /* ---------------------------------------------------------------
       7. INVOICE  (subtotal - discount = taxable, + gst = grand total)
    ----------------------------------------------------------------*/
    {
      const invoiceNo = `INV-${String(orderId).padStart(6, "0")}`;

      const [inv] = await connection.query(
        `INSERT INTO invoices
        (
          invoice_no,
          order_id,
          subtotal,
          discount,
          taxable_amount,
          gst_amount,
          grand_total,
          payment_status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          invoiceNo,
          orderId,
          totals.subtotal,
          totals.discount,
          totals.taxableAmount,
          totals.gst,
          totals.grandTotal,
          method === "online" ? "pending" : "unpaid",
        ]
      );

      for (const line of pricedLines) {
        await connection.query(
          `INSERT INTO invoice_items
          (
            invoice_id,
            product_id,
            description,
            sku,
            quantity,
            rate,
            gst_percent,
            amount
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            inv.insertId,
            line.productId,
            line.name,
            line.sku,
            line.quantity,
            line.price,
            // The rate actually charged on this invoice, so the lines agree
            // with invoices.gst_amount. `products.gst_percent` is 0 for every
            // product in this project and is deliberately not written here:
            // reconciling product master tax data is invoice-phase work.
            APPLIED_GST_PERCENT,
            line.lineTotal,
          ]
        );
      }
    }

    await connection.commit();

    /* ---------------------------------------------------------------
       8. NON-BREAKING POST-COMMIT HOOKS
    ----------------------------------------------------------------*/
    try {
      if (promo.id) {
        await connection.query(
          "INSERT INTO promotion_usage (promotion_id, order_id, user_id, discount_applied) VALUES (?, ?, ?, ?)",
          [promo.id, orderId, req.user.id, promo.discount]
        );
        await connection.query(
          "UPDATE promotions SET used_count = used_count + 1 WHERE id = ?",
          [promo.id]
        );
      }

      const [adminRows] = await pool.query(
        "SELECT id FROM users WHERE role='admin' AND is_active=1 LIMIT 10"
      );
      for (const a of adminRows) {
        await createNotification(pool, {
          userId: a.id,
          title: "New Order",
          message: `New order #${orderId} for ${customerName} worth ₹${totals.grandTotal}`,
          type: "order",
          referenceType: "order",
          referenceId: orderId,
        });
      }

      await logActivity(pool, {
        userId: req.user.id,
        action: "CREATE",
        module: "ORDER",
        description: `Created order #${orderId} (₹${totals.grandTotal})`,
        referenceType: "order",
        referenceId: orderId,
        ipAddress: req.ip,
      });
    } catch (hookErr) {
      console.error("ORDER NOTIFY/AUDIT ERROR:", hookErr);
    }

    res.status(201).json({
      success: true,
      orderId,
      status: "pending",
      payment_status: method === "online" ? "pending" : "unpaid",
      payment_method: method,
      // Authoritative, server-calculated amounts.
      subtotal: totals.subtotal,
      discount: totals.discount,
      taxable_amount: totals.taxableAmount,
      gst: totals.gst,
      gst_rate: ORDER_GST_RATE,
      total: totals.subtotal,
      grand_total: totals.grandTotal,
      amount_due: totals.grandTotal,
      items: pricedLines.map((l) => ({
        id: l.productId,
        quantity: l.quantity,
        price: l.price,
        line_total: l.lineTotal,
      })),
    });
  } catch (err) {
    if (connection) {
      try {
        await connection.rollback();
      } catch {
        /* connection already closed */
      }
    }

    // Deadlock / lock-wait timeouts are transient contention between two
    // concurrent stock deductions. Report them as retryable (409) instead of
    // a server error so clients retry rather than seeing a 500.
    if (err.code === "ER_LOCK_DEADLOCK" || err.code === "ER_LOCK_WAIT_TIMEOUT") {
      console.warn("CREATE ORDER CONTENTION:", err.code);
      return res.status(409).json({
        error:
          "Inventory was being updated by another request. Please retry this order.",
      });
    }

    // Business-rule failures are the caller's fault, never a 500.
    if (err.status === 400 || err.status === 403) {
      return res.status(err.status).json({ error: err.message });
    }

    const clientErrors = [
      "Insufficient stock for product",
      "Product",
      "Invalid or expired promotion code",
      "Promotion usage limit reached",
    ];
    if (clientErrors.some((prefix) => String(err.message || "").startsWith(prefix))) {
      return res.status(400).json({ error: err.message });
    }

    console.error("CREATE ORDER ERROR:", err);

    res.status(500).json({
      error: "Failed to create order",
    });
  } finally {
    if (connection) connection.release();
  }
});

/* =====================================================
   ORDER LIFECYCLE
   - Authoritative transition table (utils/orderTotals.js)
   - Row lock + transaction: the status is re-read under FOR UPDATE so two
     concurrent transitions can never both pass the validation
   - Cancellation ALWAYS goes through restoreStockForCancellation(), so stock
     is restored and audited no matter which endpoint cancelled the order
   ===================================================== */

/**
 * Restore stock for every line of a cancelled order and record the matching
 * inventory movements. Must be called inside a transaction that already holds
 * the order row lock.
 */
async function restoreStockForCancellation(connection, orderId, reason, userId) {
  const [itemRows] = await connection.query(
    "SELECT product_id, quantity FROM order_items WHERE order_id=?",
    [orderId]
  );

  for (const item of itemRows) {
    const [[product]] = await connection.query(
      "SELECT id, stock FROM products WHERE id=? FOR UPDATE",
      [item.product_id]
    );

    // A hard-deleted product keeps its cancellation history intact.
    if (!product) continue;

    const prevStock = Number(product.stock || 0);
    const newStock = prevStock + Number(item.quantity);

    await connection.query("UPDATE products SET stock=? WHERE id=?", [
      newStock,
      item.product_id,
    ]);

    await connection.query(
      `INSERT INTO inventory_movements
       (product_id, movement_type, quantity, prev_stock, new_stock, reference_type, reference_id, reason, created_by)
       VALUES (?, 'IN', ?, ?, ?, 'CANCELLATION', ?, ?, ?)`,
      [
        item.product_id,
        item.quantity,
        prevStock,
        newStock,
        orderId,
        reason || "Order cancelled",
        userId,
      ]
    );
  }
}

/** True when `order.user_id` is the authenticated user (or the caller is admin). */
function isOrderOwnerOrAdmin(req, order) {
  if (req.user.role === "admin") return true;
  return String(order.user_id) === String(req.user.id);
}

app.put(
  "/api/orders/:id/status",
  authRequired,
  adminOnly,
  async (req, res) => {
    const orderId = req.params.id;
    const status = req.body?.status == null ? "" : String(req.body.status).trim();
    const note = req.body?.note == null ? "" : String(req.body.note).slice(0, 255);

    if (!isValidOrderId(orderId)) {
      return res.status(400).json({ error: "Invalid order id" });
    }

    if (!status) {
      return res.status(400).json({ error: "Status is required" });
    }

    if (!ORDER_STATUSES.includes(status)) {
      return res.status(400).json({ error: "Invalid status value" });
    }

    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      // Lock first, then validate: closes the read-then-write race where two
      // admins (or an admin and a customer cancel) act on the same order.
      const [orderRows] = await connection.query(
        "SELECT id, user_id, customer_name, status FROM orders WHERE id=? FOR UPDATE",
        [orderId]
      );

      if (!orderRows.length) {
        await connection.rollback();
        return res.status(404).json({ error: "Order not found" });
      }

      const order = orderRows[0];
      const current = order.status;

      if (current === status) {
        await connection.rollback();
        return res
          .status(400)
          .json({ error: `Order is already '${status}'` });
      }

      const allowed = STATUS_TRANSITIONS[current] || [];

      if (!allowed.includes(status)) {
        await connection.rollback();
        return res.status(400).json({
          error:
            allowed.length === 0
              ? `Order is '${current}' and can no longer be changed`
              : `Cannot change order from '${current}' to '${status}'`,
        });
      }

      // Cancelling through the status endpoint must behave exactly like
      // POST /api/orders/:id/cancel, otherwise stock is never restored.
      if (status === "cancelled") {
        await restoreStockForCancellation(
          connection,
          Number(orderId),
          note || "Order cancelled",
          req.user.id
        );
      }

      await connection.query("UPDATE orders SET status=? WHERE id=?", [
        status,
        orderId,
      ]);

      await connection.query(
        `INSERT INTO order_status_history
         (order_id, status, prev_status, note, changed_by)
         VALUES (?, ?, ?, ?, ?)`,
        [orderId, status, current, note || "Status updated", req.user.id]
      );

      await connection.commit();

      // Non-breaking hooks: notify customer on shipped/delivered, audit every change
      try {
        if (["shipped", "delivered"].includes(status) && order.user_id) {
          const statusLabel = status === "shipped" ? "Shipped" : "Delivered";
          await createNotification(pool, {
            userId: order.user_id,
            title: `Order ${statusLabel}`,
            message: `Your order #${orderId} is now ${status}${note ? `: ${note}` : ""}`,
            type: "order",
            referenceType: "order",
            referenceId: Number(orderId),
          });
        }
        await logActivity(pool, {
          userId: req.user.id,
          action: status === "cancelled" ? "CANCEL" : "UPDATE",
          module: "ORDER",
          description: `Order #${orderId} status changed from '${current}' to '${status}'`,
          referenceType: "order",
          referenceId: Number(orderId),
          ipAddress: req.ip,
        });
      } catch (hookErr) {
        console.error("ORDER STATUS NOTIFY/AUDIT ERROR:", hookErr);
      }

      res.json({ success: true, status, previous_status: current });
    } catch (err) {
      await connection.rollback().catch(() => {});

      if (err.code === "ER_LOCK_DEADLOCK" || err.code === "ER_LOCK_WAIT_TIMEOUT") {
        return res.status(409).json({
          error:
            "This order is being updated by another request. Please retry.",
        });
      }

      console.error("UPDATE ORDER STATUS ERROR:", err);

      res
        .status(500)
        .json({ error: "Failed to update order status" });
    } finally {
      connection.release();
    }
  }
);

/* =====================================================
   CUSTOMER / ADMIN ORDER CANCELLATION
   - Only cancellable before shipping (pending/processing/confirmed)
   - Restores product stock, records inventory IN movement
   - Writes status history, notifies the customer, audits the action
   ===================================================== */

app.post("/api/orders/:id/cancel", authRequired, async (req, res) => {
  const orderId = req.params.id;
  const reason = String(req.body?.reason || "").trim().slice(0, 255);

  if (!isValidOrderId(orderId)) {
    return res.status(400).json({ error: "Invalid order id" });
  }

  const connection = await pool.getConnection();

  try {
    // Start the transaction BEFORE reading the order and lock the order row
    // (FOR UPDATE). Without this, two concurrent cancel requests can both pass
    // the "already cancelled" check and restore stock twice.
    await connection.beginTransaction();

    const [orderRows] = await connection.query(
      "SELECT id, user_id, status FROM orders WHERE id=? FOR UPDATE",
      [orderId]
    );

    if (!orderRows.length) {
      await connection.rollback();
      return res.status(404).json({ error: "Order not found" });
    }

    const order = orderRows[0];

    if (!isOrderOwnerOrAdmin(req, order)) {
      await connection.rollback();
      return res
        .status(403)
        .json({ error: "You are not authorized to cancel this order" });
    }

    if (order.status === "cancelled") {
      await connection.rollback();
      return res.status(400).json({ error: "Order is already cancelled" });
    }

    if (!CANCELLABLE_STATUSES.includes(order.status)) {
      await connection.rollback();
      return res.status(400).json({
        error: `Order cannot be cancelled once it is '${order.status}'. Cancellation is allowed before shipping.`,
      });
    }

    await restoreStockForCancellation(
      connection,
      Number(orderId),
      reason || "Order cancelled",
      req.user.id
    );

    await connection.query("UPDATE orders SET status='cancelled' WHERE id=?", [
      orderId,
    ]);

    await connection.query(
      `INSERT INTO order_status_history
       (order_id, status, prev_status, note, changed_by)
       VALUES (?, 'cancelled', ?, ?, ?)`,
      [orderId, order.status, reason || "Order cancelled", req.user.id]
    );

    await connection.commit();

    // Non-breaking hooks: notify + audit
    try {
      await createNotification(pool, {
        userId: order.user_id,
        title: "Order Cancelled",
        message: `Your order #${orderId} has been cancelled${reason ? `: ${reason}` : ""}`,
        type: "order",
        referenceType: "order",
        referenceId: Number(orderId),
      });
      await logActivity(pool, {
        userId: req.user.id,
        action: "CANCEL",
        module: "ORDER",
        description: `Order #${orderId} cancelled${reason ? ` (${reason})` : ""}`,
        referenceType: "order",
        referenceId: Number(orderId),
        ipAddress: req.ip,
      });
    } catch (hookErr) {
      console.error("ORDER CANCEL NOTIFY/AUDIT ERROR:", hookErr);
    }

    res.json({ success: true, status: "cancelled" });
  } catch (err) {
    await connection.rollback().catch(() => {});

    if (err.code === "ER_LOCK_DEADLOCK" || err.code === "ER_LOCK_WAIT_TIMEOUT") {
      return res.status(409).json({
        error: "This order is being updated by another request. Please retry.",
      });
    }

    console.error("ORDER CANCEL ERROR:", err);
    res.status(500).json({ error: "Failed to cancel order" });
  } finally {
    connection.release();
  }
});

/* =====================================================
   MULTER UPLOAD (SECURE)
   - Auth + admin-only
   - Only JPEG / PNG / WebP (validated by MIME + magic bytes)
   - 5 MB file size limit
   - Random server-generated filenames (original name NEVER used)
   - Image URLs built from UPLOAD_BASE_URL env (no hardcoded host)
===================================================== */

const ALLOWED_IMAGE_TYPES = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

// Reject filenames that hint at executable/script/archive content even if the
// MIME type was claimed as an image (defense in depth).
const BLOCKED_FILENAME_PATTERN =
  /\.(?:html?|svg|js|jse|mjs|php|exe|com|msi|bat|cmd|sh|bash|ps1|zip|rar|7z|tar|gz|xhtml|xml|app|jar|apk)$/i;

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = ALLOWED_IMAGE_TYPES[file.mimetype] || ".jpg";
    cb(null, crypto.randomBytes(16).toString("hex") + ext);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_IMAGE_TYPES[file.mimetype]) {
      return cb(new Error("Only JPEG, PNG and WebP images are allowed"));
    }
    if (BLOCKED_FILENAME_PATTERN.test(file.originalname || "")) {
      return cb(new Error("File type not allowed"));
    }
    cb(null, true);
  },
});

// Verify the actual file content (magic bytes) so a mislabeled HTML/SVG/script
// file cannot be stored even if the MIME type was spoofed.
function validImageFile(filePath) {
  try {
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(16);
    fs.readSync(fd, buf, 0, 16, 0);
    fs.closeSync(fd);

    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true; // JPEG
    if (
      buf.readUInt32BE(0) === 0x89504e47 &&
      buf.readUInt32BE(4) === 0x0d0a1a0a
    )
      return true; // PNG
    if (
      buf.toString("ascii", 0, 4) === "RIFF" &&
      buf.toString("ascii", 8, 12) === "WEBP"
    )
      return true; // WebP
    return false;
  } catch {
    return false;
  }
}

app.post(
  "/api/upload",
  authRequired,
  adminOnly,
  upload.single("image"),
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({
        error: "No image uploaded",
      });
    }

    const savedPath = path.isAbsolute(req.file.path)
      ? req.file.path
      : path.join(process.cwd(), req.file.path);

    if (!validImageFile(savedPath)) {
      await fs.promises.unlink(savedPath).catch(() => {});
      return res.status(400).json({
        error: "Uploaded file is not a valid image",
      });
    }

    const base = (process.env.UPLOAD_BASE_URL || "").replace(/\/+$/, "");
    const imageUrl = base
      ? `${base}/uploads/${req.file.filename}`
      : `/uploads/${req.file.filename}`;

    res.json({
      imageUrl,
    });
  }
);

/* =====================================================
   AUTH
===================================================== */

/* REGISTER */

// Public registration ALWAYS creates a "customer" account.
// A client-supplied role (e.g. { role: "admin" }) is ignored.
// Staff accounts can only be created by admins via the protected
// POST /api/users endpoint (authRequired + adminOnly).

app.post("/api/auth/register", authLimiter, async (req, res) => {
  try {
    const {
      name,
      email,
      password,
    } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        error: "Name, email and password are required",
      });
    }

    if (String(password).length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    const hashed = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users
      (
        name,
        email,
        password,
        role,
        is_active
      )
      VALUES (?, ?, ?, 'customer', 1)`,
      [
        name,
        email.toLowerCase(),
        hashed,
      ]
    );

    const userId = result[0].insertId;

    await pool.query(
      "INSERT INTO loyalty_accounts (user_id, points_balance, total_earned, total_redeemed) VALUES (?, 0, 0, 0) ON DUPLICATE KEY UPDATE user_id=user_id",
      [userId]
    );

    res.json({
      success: true,
    });

    try {
      await pool.query(
        `INSERT INTO security_events (user_id, event_type, severity, description, ip_address)
         VALUES (?, 'REGISTER', 'info', 'New account registered', ?)`,
        [userId, req.ip]
      );
    } catch (hookErr) {
      console.error("REGISTER SECURITY EVENT ERROR:", hookErr);
    }
  } catch (err) {
    console.error("REGISTER ERROR:", err);

    if (err.code === "ER_DUP_ENTRY") {
      return res.status(400).json({
        error: "Email already registered",
      });
    }

    res.status(500).json({
      success: false,
    });
  }
});

/* LOGIN */

app.post("/api/auth/login", authLimiter, async (req, res) => {
  try {
    const email = String(
      req.body.email || ""
    ).toLowerCase();

    const password = req.body.password;

    const [rows] = await pool.query(
      "SELECT * FROM users WHERE email=?",
      [email]
    );

    const user = rows[0];

    if (!user) {
      try {
        await pool.query(
          `INSERT INTO security_events (event_type, severity, description, ip_address, user_agent)
           VALUES ('LOGIN_FAILED', 'warning', ?, ?, ?)`,
          [`Failed login: unknown email (${email})`, req.ip, (req.headers['user-agent'] || '').slice(0,255)]
        );
      } catch (e) { /* non-blocking */ }
      return res.status(401).json({
        message: "Invalid email or password",
      });
    }

    if (user.is_active === 0) {
      return res.status(403).json({ message: "Account is disabled. Contact admin." });
    }

    const match = await bcrypt.compare(
      password,
      user.password
    );

    if (!match) {
      try {
        await pool.query(
          `INSERT INTO security_events (user_id, event_type, severity, description, ip_address, user_agent)
           VALUES (?, 'LOGIN_FAILED', 'warning', 'Failed password attempt', ?, ?)`,
          [user.id, req.ip, (req.headers['user-agent'] || '').slice(0,255)]
        );
      } catch (e) { /* non-blocking */ }
      return res.status(401).json({
        message: "Invalid email or password",
      });
    }

    const token = jwt.sign(
      {
        id: user.id,
        role: user.role,
      },
      JWT_SECRET,
      {
        expiresIn: "1h",
      }
    );

    // The session row must exist BEFORE we answer: the client fires its
    // first authenticated request immediately, and authRequired requires a
    // live session row. Inserting afterwards races that request.
    try {
      await pool.query(
        `INSERT INTO user_sessions (user_id, token, device_info, is_active)
         VALUES (?, ?, ?, 1)`,
        [String(user.id), hashToken(token), (req.headers['user-agent'] || '').slice(0,500)]
      );
    } catch (sessionErr) {
      console.error("LOGIN SESSION ERROR:", sessionErr);
      return res.status(500).json({
        success: false,
        message: "Could not start session",
      });
    }

    res.json({
      accessToken: token,

      user: {
        id: user.id,
        name: user.name,
        role: user.role,
      },
    });

    // Non-breaking audit: record login (after response)
    try {
      await logActivity(pool, {
        userId: user.id,
        action: "LOGIN",
        module: "AUTH",
        description: `User logged in (${user.role})`,
        ipAddress: req.ip,
      });
      await pool.query(
        `INSERT INTO security_events (user_id, event_type, severity, description, ip_address, user_agent)
         VALUES (?, 'LOGIN', 'info', 'Successful login', ?, ?)`,
        [user.id, req.ip, (req.headers['user-agent'] || '').slice(0,255)]
      );
    } catch (hookErr) {
      console.error("LOGIN AUDIT ERROR:", hookErr);
    }
  } catch (err) {
    console.error("LOGIN ERROR:", err);

    res.status(500).json({
      success: false,
    });
  }
});

/* LOGOUT */

app.post("/api/auth/logout", async (req, res) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];

    // Verify before acting so a logout request can only ever revoke the
    // session belonging to the caller who presented a valid token.
    let userId = null;
    if (token) {
      try {
        userId = jwt.verify(token, JWT_SECRET).id;
      } catch (e) {
        userId = null;
      }
      await pool.query(
        "UPDATE user_sessions SET is_active=0 WHERE token=?" + (userId ? " AND user_id=?" : ""),
        userId ? [hashToken(token), String(userId)] : [hashToken(token)]
      );
    }

    try {
      await pool.query(
        `INSERT INTO security_events (user_id, event_type, severity, description, ip_address)
         VALUES (?, 'LOGOUT', 'info', 'User logged out', ?)`,
        [userId, req.ip]
      );
    } catch (e) { /* non-blocking */ }
  } catch (err) {
    console.error("LOGOUT ERROR:", err);
  }
  res.json({ success: true });
});

/* =====================================================
   PASSWORD RESET OTP
===================================================== */

const OTP_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
const OTP_EXPIRY_MINUTES = 10;
const OTP_ATTEMPT_LIMIT = 5;
const OTP_GENERIC_MESSAGE =
  "If the account exists, a password reset code has been sent.";

/* FORGOT PASSWORD */

app.post(
  "/api/auth/forgot-password",
  passwordResetLimiter,
  async (req, res) => {
    try {
      const email = String(req.body.email || "")
        .toLowerCase()
        .trim();

      if (!email) {
        return res.status(400).json({
          error: "Email is required",
        });
      }

      const [rows] = await pool.query(
        "SELECT id FROM users WHERE email=?",
        [email]
      );

      if (rows.length > 0) {
        // Invalidate any previous outstanding reset so only the newest OTP is valid.
        await pool.query(
          "UPDATE password_resets SET is_used=1 WHERE email=?",
          [email]
        );

        const otp = String(crypto.randomInt(100000, 1000000));
        const otpHash = await bcrypt.hash(otp, 10);
        const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS);

        await pool.query(
          `INSERT INTO password_resets
          (
            email,
            otp_hash,
            expires_at,
            is_used,
            attempts
          )
          VALUES (?, ?, ?, 0, 0)`,
          [email, otpHash, expiresAt]
        );

        // The OTP is NEVER returned by this API. It must be delivered by an
        // email/SMS provider (see README). The code path below only logs the
        // OTP during LOCAL development when explicitly enabled - never in
        // production.
        if (
          process.env.NODE_ENV !== "production" &&
          process.env.RESET_DEV_LOG === "true"
        ) {
          console.log(`[DEV ONLY] Password reset OTP for ${email}: ${otp}`);
        }
      }

      return res.json({
        success: true,
        message: OTP_GENERIC_MESSAGE,
      });

    } catch (err) {
      console.error(
        "FORGOT PASSWORD ERROR:",
        err
      );

      res.status(500).json({
        error: "Failed to request password reset",
      });
    }
  }
);

/* VERIFY OTP */

async function incrementOtpAttempts(poolRef, id) {
  try {
    await poolRef.query(
      "UPDATE password_resets SET attempts=attempts+1 WHERE id=?",
      [id]
    );
  } catch (err) {
    // attempts column only exists after migration 009; ignore on legacy schemas.
    if (!err.code || err.code !== "ER_BAD_FIELD_ERROR") throw err;
  }
}

app.post(
  "/api/auth/verify-otp",
  otpVerifyLimiter,
  async (req, res) => {
    try {
      const email = String(req.body.email || "")
        .toLowerCase()
        .trim();
      const otp = String(req.body.otp || "").trim();

      if (!email || !otp) {
        return res.status(400).json({
          error: "Email and OTP are required",
        });
      }

      const [rows] = await pool.query(
        `SELECT id, otp_hash, expires_at, is_used, attempts, verified_at
         FROM password_resets
         WHERE email=? AND is_used=0
         ORDER BY id DESC
         LIMIT 1`,
        [email]
      );
      const record = rows[0];

      // Generic failure message - never reveal whether an account exists.
      const genericError = "Invalid or expired password reset code";

      if (!record) {
        return res.status(400).json({ error: genericError });
      }

      if (new Date(record.expires_at) < new Date()) {
        return res.status(400).json({ error: genericError });
      }

      const attempts =
        record.attempts != null ? Number(record.attempts) : 0;

      if (attempts >= OTP_ATTEMPT_LIMIT) {
        await pool.query(
          "UPDATE password_resets SET is_used=1 WHERE id=?",
          [record.id]
        );
        return res.status(400).json({
          error: "Too many failed attempts. Please request a new code.",
        });
      }

      const match = await bcrypt.compare(
        String(otp),
        record.otp_hash
      );

      if (!match) {
        await incrementOtpAttempts(pool, record.id);
        return res.status(400).json({ error: genericError });
      }

      // Mark as verified but NOT yet consumed. The reset-password step is the
      // only thing that consumes it, and it requires a recent verification.
      await pool.query(
        "UPDATE password_resets SET verified_at=NOW(), attempts=0 WHERE id=?",
        [record.id]
      );
      // Invalidate any other outstanding (unverified) codes for this account.
      await pool.query(
        "UPDATE password_resets SET is_used=1 WHERE email=? AND id<>? AND is_used=0",
        [email, record.id]
      );

      res.json({
        success: true,
      });

    } catch (err) {
      console.error(
        "VERIFY OTP ERROR:",
        err
      );

      res.status(500).json({
        error: "Failed to verify OTP",
      });
    }
  }
);

/* RESET PASSWORD */

app.post(
  "/api/auth/reset-password",
  passwordResetLimiter,
  async (req, res) => {
    try {
      const email = String(req.body.email || "")
        .toLowerCase()
        .trim();
      const newPassword = req.body.newPassword;

      if (!email || !newPassword) {
        return res.status(400).json({
          error: "Email and new password are required",
        });
      }

      if (String(newPassword).length < 6) {
        return res.status(400).json({
          error: "Password must be at least 6 characters",
        });
      }

      const [ver] = await pool.query(
        `SELECT id
         FROM password_resets
         WHERE email=?
           AND is_used=0
           AND verified_at IS NOT NULL
           AND verified_at >= DATE_SUB(NOW(), INTERVAL ${OTP_EXPIRY_MINUTES} MINUTE)
         ORDER BY id DESC
         LIMIT 1`,
        [email]
      );

      if (!ver.length) {
        return res.status(400).json({
          error: "OTP must be verified before resetting the password",
        });
      }

      const hashed = await bcrypt.hash(
        newPassword,
        10
      );

      const [result] = await pool.query(
        `UPDATE users
         SET password=?
         WHERE email=?`,
        [
          hashed,
          email,
        ]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({
          error: "User not found",
        });
      }

      // Invalidate ALL outstanding resets for this account (single-use).
      await pool.query(
        "UPDATE password_resets SET is_used=1 WHERE email=?",
        [email]
      );

      // Log the user's active sessions out.
      try {
        const [[u]] = await pool.query(
          "SELECT id FROM users WHERE email=?",
          [email]
        );
        if (u?.id) {
          await pool.query(
            "UPDATE user_sessions SET is_active=0 WHERE user_id=?",
            [String(u.id)]
          );
          await pool.query(
            `INSERT INTO security_events (user_id, event_type, severity, description, ip_address)
             VALUES (?, 'PASSWORD_RESET', 'info', 'Password reset completed', ?)`,
            [u.id, req.ip]
          );
        }
      } catch (hookErr) {
        console.error("RESET PASSWORD AUDIT ERROR:", hookErr);
      }

      res.json({
        success: true,
        message: "Password updated successfully",
      });

    } catch (err) {
      console.error(
        "RESET PASSWORD ERROR:",
        err
      );

      res.status(500).json({
        error: "Failed to reset password",
      });
    }
  }
);

/* =====================================================
   PRODUCTS
===================================================== */

registerProductRoutes(
  app,
  pool,
  authRequired,
  adminOnly
);

/* =====================================================
   REPORTS
===================================================== */

registerReportRoutes(
  app,
  pool,
  authRequired,
  adminOnly
);

/* =====================================================
   DISTRIBUTOR MANAGEMENT SYSTEM (DMS)
===================================================== */

registerDmsRoutes(
  app,
  pool,
  authRequired,
  adminOnly
);

/* =====================================================
   DMS ADVANCED - Phases 1-5 (Sales, Territory, Purchase,
   Returns, Damaged/Expiry)
===================================================== */

registerDmsAdvancedRoutes(
  app,
  pool,
  authRequired,
  adminOnly
);

/* =====================================================
   CUSTOMER PANEL
===================================================== */

registerCustomerRoutes(
  app,
  pool,
  authRequired
);

/* =====================================================
   PHASE 6-9 - NOTIFICATIONS, ACTIVITY LOGS, ANALYTICS,
   REORDER, GLOBAL SEARCH
===================================================== */

registerNotificationRoutes(app, pool, authRequired);

registerActivityLogRoutes(app, pool, authRequired, adminOnly);

registerAnalyticsRoutes(app, pool, authRequired, adminOnly);

registerReorderRoutes(app, pool, authRequired, adminOnly);

registerGlobalSearchRoutes(app, pool, authRequired, adminOnly);

/* =====================================================
   ENTERPRISE - AI, PROFIT, PROMOTIONS, CREDIT, DELIVERIES,
   LOYALTY, WAREHOUSES, BARCODE, SALES ROUTES, COMPANIES,
   SECURITY, ADVANCED REPORTS
===================================================== */

registerAiRoutes(app, pool, authRequired, adminOnly);
/* Customer AI is customer-only and is never mounted for admins. */
registerCustomerAiRoutes(app, pool, authRequired);
registerProfitRoutes(app, pool, authRequired, adminOnly);
registerPromotionsRoutes(app, pool, authRequired, adminOnly);
registerCreditRoutes(app, pool, authRequired, adminOnly);
registerDeliveryRoutes(app, pool, authRequired, adminOnly);
registerLoyaltyRoutes(app, pool, authRequired, adminOnly);
registerWarehouseRoutes(app, pool, authRequired, adminOnly);
registerBarcodeRoutes(app, pool, authRequired, adminOnly);
registerSalesRoutes(app, pool, authRequired, adminOnly);
registerCompanyRoutes(app, pool, authRequired, adminOnly);
registerSecurityRoutes(app, pool, authRequired, adminOnly);
registerAdvancedReportRoutes(app, pool, authRequired, adminOnly);

/* =====================================================
   PAYMENT - RAZORPAY (phase 5: integrity, idempotency)
   =====================================================

   Contract enforced by the two routes below:

     * The payable amount is ALWAYS recalculated on the server from the local
       order via the canonical Phase 4.5 totals (`amountsFromOrder`). A
       client-supplied amount is never read, stored or trusted - not even for
       comparison.
     * The gateway order is bound to one local order, and the amount it was
       authorised for is persisted on the order (`razorpay_amount`), so a
       payment can later be proven to belong to THIS order for THIS amount.
     * A payment is only ever recorded after Razorpay itself confirms the
       capture: matching amount, matching currency, matching gateway order and
       a captured status. Everything else fails closed.
     * Recording a payment is idempotent at the database level
       (`payments.gateway_payment_id` is UNIQUE), inside one transaction that
       locks the order row, so concurrent replays produce exactly one payment
       row, one invoice update, one order transition and one notification.
*/

const paymentGateway = resolveGateway();

/**
 * Used only to recompute the Razorpay checkout signature. It is never sent to
 * a client, never written to a row and never logged.
 */
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "";

/**
 * Payment logging, safe by construction (phase 5, step 18).
 *
 * Only a label and a sanitised error summary are written. The gateway SDK's
 * error object can contain the request it made, so it is never logged verbatim.
 * The key secret, the Authorization header, JWTs, passwords and full card or
 * bank details must never reach this function.
 */
function logPaymentError(context, err) {
  console.error(`PAYMENT ERROR [${context}]`, safeGatewayError(err));
}

function requireGateway() {
  if (!paymentGateway) {
    const err = new Error("Payment gateway is not configured");
    err.status = 503;
    throw err;
  }
  return paymentGateway;
}

/** A locked order row for payment work, plus its canonical money figures. */
async function loadPayableOrder(conn, orderId) {
  const [[order]] = await conn.query(
    `SELECT id, user_id, status, payment_status, payment_method,
            total_amount, discount, gst, paid_amount,
            razorpay_order_id, razorpay_amount, razorpay_payment_id
       FROM orders WHERE id=? FOR UPDATE`,
    [orderId]
  );
  if (!order) return null;

  const totals = amountsFromOrder(order);
  const paid = roundMoney(order.paid_amount);
  return {
    order,
    grandTotal: totals.grandTotal,
    amountDue: roundMoney(Math.max(0, totals.grandTotal - paid)),
    paidAmount: paid,
  };
}

/** Only the owner, or an admin acting on the order, may pay for it. */
function assertOrderAccess(order, user) {
  if (user.role === "admin") return;
  if (String(order.user_id) !== String(user.id)) {
    const err = new Error("You can only pay for your own order");
    err.status = 403;
    throw err;
  }
}

/**
 * Loyalty earn, called with the transaction connection so a repeat of an
 * already-recorded payment can never credit points twice.
 */
async function awardLoyaltyPoints(conn, { userId, amount, orderId, actorId }) {
  const [[config]] = await conn.query("SELECT * FROM loyalty_config WHERE id=1");
  if (!config || config.status !== "active") return;

  const earnRate = Number(config.points_per_100_rupees) || 1;
  const pointsEarned = Math.floor((Number(amount) / 100) * earnRate);
  if (pointsEarned <= 0) return;

  await conn.query(
    "INSERT INTO loyalty_accounts (user_id, points_balance, total_earned, total_redeemed) VALUES (?, ?, ?, 0) ON DUPLICATE KEY UPDATE points_balance = points_balance + ?, total_earned = total_earned + ?",
    [userId, pointsEarned, pointsEarned, pointsEarned, pointsEarned]
  );
  const [[account]] = await conn.query(
    "SELECT points_balance FROM loyalty_accounts WHERE user_id=?",
    [userId]
  );
  await conn.query(
    "INSERT INTO loyalty_transactions (user_id, type, points, balance_after, reference_type, reference_id, note, created_by) VALUES (?, 'earn', ?, ?, 'order', ?, 'Points earned on payment', ?)",
    [userId, pointsEarned, account.points_balance, orderId, actorId]
  );
}

/* CREATE PAYMENT ORDER
 *
 * Body: { order_id }  — and nothing else. A client `amount` is ignored by
 * design; the amount comes from the order row.
 */

app.post(
  "/api/payment/create-order",
  authRequired,
  async (req, res) => {
    const { order_id } = req.body || {};

    if (!isValidOrderId(order_id)) {
      return res.status(400).json({
        error: "A valid order_id is required",
      });
    }

    try {
      const conn = await pool.getConnection();

      try {
        await conn.beginTransaction();

        const ctx = await loadPayableOrder(conn, Number(order_id));
        if (!ctx) {
          await conn.rollback();
          return res.status(404).json({ error: "Order not found" });
        }

        try {
          assertOrderAccess(ctx.order, req.user);
        } catch (accessErr) {
          await conn.rollback();
          return res.status(accessErr.status || 403).json({ error: accessErr.message });
        }

        if (ctx.order.status === "cancelled") {
          await conn.rollback();
          return res.status(409).json({
            error: "This order was cancelled and cannot be paid",
          });
        }

        if (ctx.amountDue <= 0) {
          await conn.rollback();
          return res.status(409).json({
            error: "This order is already paid in full",
          });
        }

        const amountPaise = rupeesToPaise(ctx.amountDue);
        if (!amountPaise) {
          await conn.rollback();
          return res.status(400).json({
            error: "Order total is not a payable amount",
          });
        }

        // Reuse an unsettled gateway order only when it was authorised for
        // exactly the amount still due. Anything else (a stale amount after a
        // part-payment, or a consumed payment) starts a fresh gateway order so
        // the binding recorded below is never ambiguous.
        const reusable =
          ctx.order.razorpay_order_id &&
          !ctx.order.razorpay_payment_id &&
          roundMoney(ctx.order.razorpay_amount) === ctx.amountDue;

        if (reusable) {
          await conn.commit();
          return res.json({
            id: ctx.order.razorpay_order_id,
            amount: amountPaise,
            currency: "INR",
            receipt: `order_${ctx.order.id}`,
            order_id: ctx.order.id,
            amount_due: ctx.amountDue,
            totals_basis: amountsFromOrder(ctx.order).basis,
          });
        }

        const gatewayOrder = await requireGateway().createOrder({
          amountPaise,
          currency: "INR",
          receipt: `order_${ctx.order.id}`,
          notes: { local_order_id: String(ctx.order.id) },
        });

        await conn.query(
          `UPDATE orders
              SET razorpay_order_id=?, razorpay_amount=?
            WHERE id=?`,
          [gatewayOrder.id, ctx.amountDue, ctx.order.id]
        );

        await conn.commit();

        res.json({
          id: gatewayOrder.id,
          amount: amountPaise,
          currency: gatewayOrder.currency || "INR",
          receipt: gatewayOrder.receipt || `order_${ctx.order.id}`,
          order_id: ctx.order.id,
          amount_due: ctx.amountDue,
          totals_basis: amountsFromOrder(ctx.order).basis,
        });
      } catch (err) {
        await conn.rollback();
        throw err;
      } finally {
        conn.release();
      }
    } catch (err) {
      logPaymentError("CREATE PAYMENT ORDER", err);

      res.status(err.status || 502).json({
        error: err.status === 503 ? err.message : "Could not start the payment",
      });
    }
  }
);

/* VERIFY PAYMENT
 *
 * Body: { razorpay_order_id, razorpay_payment_id, razorpay_signature, order_id }
 * Identity fields in the body are ignored beyond these four.
 */

app.post(
  "/api/payment/verify",
  authRequired,
  async (req, res) => {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      order_id,
    } = req.body || {};

    if (
      !isValidGatewayId(razorpay_order_id) ||
      !isValidGatewayId(razorpay_payment_id) ||
      !isValidOrderId(order_id)
    ) {
      return res.status(400).json({
        error: "Invalid payment verification request",
      });
    }

    let conn;

    try {
      conn = await pool.getConnection();
      await conn.beginTransaction();

      const ctx = await loadPayableOrder(conn, Number(order_id));
      if (!ctx) {
        await conn.rollback();
        return res.status(404).json({ error: "Order not found" });
      }

      try {
        assertOrderAccess(ctx.order, req.user);
      } catch (accessErr) {
        await conn.rollback();
        return res.status(accessErr.status || 403).json({ error: accessErr.message });
      }

      // The gateway order must be the one this order was bound to. Without
      // this, a genuine low-value payment made against a customer's own order
      // could be presented here to settle a different, expensive order.
      if (!ctx.order.razorpay_order_id || ctx.order.razorpay_order_id !== razorpay_order_id) {
        await conn.rollback();
        return res.status(400).json({
          error: "Payment does not belong to this order",
        });
      }

      // Signature first: it is cheap and stateless.
      if (
        !verifyGatewaySignature(
          RAZORPAY_KEY_SECRET,
          razorpay_order_id,
          razorpay_payment_id,
          razorpay_signature
        )
      ) {
        await conn.rollback();
        return res.status(400).json({ error: "Invalid signature" });
      }

      // Already processed? Return the existing state and change nothing. This
      // is checked before the paid/already-paid rules so a genuine client retry
      // of a successful payment is answered, not rejected.
      const [[existingPayment]] = await conn.query(
        "SELECT id, order_id, amount FROM payments WHERE gateway_payment_id=?",
        [razorpay_payment_id]
      );

      if (existingPayment) {
        if (String(existingPayment.order_id) !== String(ctx.order.id)) {
          await conn.rollback();
          return res.status(409).json({
            error: "This payment has already been recorded against another order",
          });
        }

        await conn.commit();
        return res.json({
          success: true,
          alreadyProcessed: true,
          payment_id: existingPayment.id,
          order_id: ctx.order.id,
          paid_amount: ctx.paidAmount,
          payment_status: ctx.order.payment_status,
          message: "Payment already verified",
        });
      }

      if (ctx.order.status === "cancelled") {
        await conn.rollback();
        return res.status(409).json({
          error: "This order was cancelled and cannot be paid",
        });
      }

      if (ctx.amountDue <= 0) {
        await conn.rollback();
        return res.status(409).json({
          error: "This order is already paid in full",
        });
      }

      const authorisedRupees = roundMoney(ctx.order.razorpay_amount);
      const authorisedPaise = rupeesToPaise(authorisedRupees);

      if (!authorisedPaise) {
        await conn.rollback();
        return res.status(400).json({
          error: "No authorised payment amount for this order",
        });
      }

      // Ask Razorpay what was actually captured. This is what makes the check
      // authoritative: the signature only proves Razorpay signed two ids.
      let gatewayPayment;
      try {
        gatewayPayment = await requireGateway().fetchPayment(razorpay_payment_id);
      } catch (gatewayErr) {
        await conn.rollback();
        logPaymentError("GATEWAY PAYMENT LOOKUP", gatewayErr);
        return res.status(400).json({
          error: "Payment could not be confirmed with the payment provider",
        });
      }

      if (!gatewayPayment || gatewayPayment.order_id !== razorpay_order_id) {
        await conn.rollback();
        return res.status(400).json({
          error: "Payment does not match the order it was raised for",
        });
      }

      if (String(gatewayPayment.status || "").toLowerCase() !== "captured") {
        await conn.rollback();
        return res.status(409).json({
          error: `Payment is not captured (status: ${String(gatewayPayment.status || "unknown")})`,
        });
      }

      const currency = String(gatewayPayment.currency || "").toUpperCase();
      if (currency !== "INR") {
        await conn.rollback();
        return res.status(400).json({
          error: "Payment currency does not match the order currency",
        });
      }

      const capturedPaise = Number(gatewayPayment.amount);
      if (!Number.isSafeInteger(capturedPaise) || capturedPaise !== authorisedPaise) {
        await conn.rollback();
        return res.status(400).json({
          error: "Payment amount does not match the order total",
        });
      }

      const amountReceived = paiseToRupees(capturedPaise);

      // Guard against over-payment even if the order changed underneath us.
      if (roundMoney(ctx.paidAmount + amountReceived) > roundMoney(ctx.grandTotal + 0.01)) {
        await conn.rollback();
        return res.status(400).json({
          error: "Payment exceeds the outstanding balance for this order",
        });
      }

      // ---- single logical payment operation from here to COMMIT ----
      let paymentId;
      try {
        const [insert] = await conn.query(
          `INSERT INTO payments
             (order_id, amount, method, note, created_by,
              gateway, gateway_order_id, gateway_payment_id, currency)
           VALUES (?, ?, 'online', 'Razorpay payment', ?,
                   'razorpay', ?, ?, ?)`,
          [
            ctx.order.id,
            amountReceived,
            req.user.id,
            razorpay_order_id,
            razorpay_payment_id,
            currency,
          ]
        );
        paymentId = insert.insertId;
      } catch (insertErr) {
        if (insertErr?.code !== "ER_DUP_ENTRY") throw insertErr;

        // Lost a race against a concurrent identical verify. The other
        // transaction owns the payment; report its state, add nothing.
        await conn.rollback();
        const [[winner]] = await pool.query(
          "SELECT id, order_id FROM payments WHERE gateway_payment_id=?",
          [razorpay_payment_id]
        );
        return res.json({
          success: true,
          alreadyProcessed: true,
          payment_id: winner?.id ?? null,
          order_id: ctx.order.id,
          message: "Payment already verified",
        });
      }

      const newPaid = roundMoney(ctx.paidAmount + amountReceived);
      const paymentStatus = paymentStatusFor(newPaid, ctx.grandTotal);

      await conn.query(
        `UPDATE orders
            SET paid_amount=?, payment_status=?, razorpay_payment_id=?
          WHERE id=?`,
        [newPaid, paymentStatus, razorpay_payment_id, ctx.order.id]
      );

      // Settle only the order's outstanding invoice, and only when the order
      // is actually settled. Never blanket-mark every invoice of the order.
      if (paymentStatus === "paid") {
        await conn.query(
          `UPDATE invoices SET payment_status='paid'
            WHERE order_id=? AND (payment_status IS NULL OR payment_status<>'paid')`,
          [ctx.order.id]
        );
      } else {
        await conn.query(
          "UPDATE invoices SET payment_status=? WHERE order_id=? AND (payment_status IS NULL OR payment_status<>'paid')",
          [paymentStatus, ctx.order.id]
        );
      }

      // Hooks run inside the same transaction as the payment row, so a replay
      // can never produce a second notification, audit entry or loyalty credit.
      // Each hook is individually non-fatal: losing an audit row must never
      // lose a captured payment.
      try {
        await createNotification(conn, {
          userId: ctx.order.user_id,
          title: "Payment Received",
          message: `Payment of ₹${amountReceived} received for order #${ctx.order.id}`,
          type: "payment",
          referenceType: "order",
          referenceId: ctx.order.id,
        });
      } catch (hookErr) {
        logPaymentError("PAYMENT NOTIFY", hookErr);
      }

      try {
        await logActivity(conn, {
          userId: req.user.id,
          action: "PAYMENT",
          module: "PAYMENT",
          description: `Payment of ₹${amountReceived} verified for order #${ctx.order.id}`,
          referenceType: "order",
          referenceId: ctx.order.id,
          ipAddress: req.ip,
        });
      } catch (hookErr) {
        logPaymentError("PAYMENT AUDIT", hookErr);
      }

      try {
        await awardLoyaltyPoints(conn, {
          userId: ctx.order.user_id,
          amount: amountReceived,
          orderId: ctx.order.id,
          actorId: req.user.id,
        });
      } catch (hookErr) {
        logPaymentError("PAYMENT LOYALTY", hookErr);
      }

      await conn.commit();

      res.json({
        success: true,
        alreadyProcessed: false,
        payment_id: paymentId,
        order_id: ctx.order.id,
        paid_amount: newPaid,
        payment_status: paymentStatus,
        amount_paid: amountReceived,
        currency,
        message: "Payment successful",
      });
    } catch (err) {
      if (conn) await conn.rollback();
      logPaymentError("VERIFY PAYMENT", err);

      res.status(err.status || 500).json({
        error: err.status ? err.message : "Verification failed",
      });
    } finally {
      if (conn) conn.release();
    }
  }
);

/* =====================================================
   LOW STOCK SETTINGS
===================================================== */

app.get(
  "/api/settings/low-stock",
  authRequired,
  adminOnly,
  async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT svalue
         FROM settings
         WHERE skey='low_stock_threshold'`
      );

      const threshold =
        rows.length
          ? Number(rows[0].svalue)
          : 5;

      const [[countRow]] =
        await pool.query(
          `SELECT COUNT(*) total
           FROM products
           WHERE is_deleted=0
           AND stock <= ?`,
          [threshold]
        );

      res.json({
        threshold,
        lowStockCount:
          countRow.total,
      });

    } catch (err) {
      console.error(
        "GET LOW STOCK SETTINGS ERROR:",
        err
      );

      res.status(500).json({
        error:
          "Failed to fetch low-stock settings",
      });
    }
  }
);

app.put(
  "/api/settings/low-stock",
  authRequired,
  adminOnly,
  async (req, res) => {
    try {
      const threshold = Number(
        req.body.threshold
      );

      if (
        !Number.isInteger(threshold) ||
        threshold < 0 ||
        threshold > 10000
      ) {
        return res.status(400).json({
          error:
            "Threshold must be an integer between 0 and 10000",
        });
      }

      await pool.query(
        `INSERT INTO settings
        (
          skey,
          svalue
        )
        VALUES ('low_stock_threshold', ?)
        ON DUPLICATE KEY UPDATE
        svalue=VALUES(svalue)`,
        [String(threshold)]
      );

      res.json({
        success: true,
        threshold,
      });

    } catch (err) {
      console.error(
        "PUT LOW STOCK SETTINGS ERROR:",
        err
      );

      res.status(500).json({
        error:
          "Failed to update low-stock threshold",
      });
    }
  }
);

/* =====================================================
   MAIN DASHBOARD
===================================================== */

app.get(
  "/api/dashboard/full",
  authRequired,
  adminOnly,
  async (req, res) => {
    try {
      const [[products]] =
        await pool.query(
          `SELECT COUNT(*) total
           FROM products
           WHERE is_deleted=0`
        );

      const [[customers]] =
        await pool.query(
          `SELECT COUNT(*) total
           FROM users
           WHERE role='customer'`
        );

      const [[orders]] =
        await pool.query(
          "SELECT COUNT(*) total FROM orders"
        );

      const [[revenue]] =
        await pool.query(
          `SELECT
            IFNULL(
              SUM(total_amount),
              0
            ) total
           FROM orders`
        );

      const [salesChart] =
        await pool.query(`
          SELECT
            DATE_FORMAT(
              created_at,
              '%d %b'
            ) AS date,

            CAST(
              SUM(total_amount)
              AS DOUBLE
            ) AS amount

          FROM orders

          WHERE created_at >=
            DATE_SUB(
              CURDATE(),
              INTERVAL 7 DAY
            )

          GROUP BY
            DATE(created_at),
            DATE_FORMAT(
              created_at,
              '%d %b'
            )

          ORDER BY DATE(created_at)
        `);

      const [orderStatusStats] =
        await pool.query(`
          SELECT
            status,
            COUNT(*) AS count
          FROM orders
          GROUP BY status
        `);

      const [settingsRows] =
        await pool.query(
          `SELECT svalue
           FROM settings
           WHERE skey='low_stock_threshold'`
        );

      const lowStockThreshold =
        settingsRows.length
          ? Number(
              settingsRows[0].svalue
            )
          : 5;

      const [lowStock] =
        await pool.query(
          `SELECT
            id,
            name,
            stock,
            price
           FROM products
           WHERE stock <= ?
           AND is_deleted=0
           ORDER BY stock ASC
           LIMIT 10`,
          [lowStockThreshold]
        );

      const [[lowStockCountRow]] =
        await pool.query(
          `SELECT COUNT(*) total
           FROM products
           WHERE is_deleted=0
           AND stock <= ?`,
          [lowStockThreshold]
        );

      const [recentOrders] =
        await pool.query(`
          SELECT
            o.id,

            COALESCE(
              u.name,
              o.customer_name
            ) AS customer,

            CAST(
              o.total_amount
              AS DOUBLE
            ) AS total,

            o.status

          FROM orders o

          LEFT JOIN users u
          ON o.user_id=u.id

          ORDER BY o.created_at DESC

          LIMIT 5
        `);

      const [[pendingOrdersRow]] =
        await pool.query(
          `SELECT COUNT(*) total
           FROM orders
           WHERE status IN ('pending','processing','confirmed')`
        );

      const [ordersTrend] =
        await pool.query(`
          SELECT
            DATE_FORMAT(created_at, '%d %b') AS date,
            COUNT(*) AS orders
          FROM orders
          WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
          GROUP BY DATE(created_at), DATE_FORMAT(created_at, '%d %b')
          ORDER BY DATE(created_at)
        `);

      const [topProducts] =
        await pool.query(`
          SELECT
            p.id,
            COALESCE(p.name, CONCAT('Product #', oi.product_id)) AS name,
            SUM(oi.quantity) AS qty_sold,
            CAST(SUM(oi.quantity * oi.price) AS DOUBLE) AS revenue
          FROM order_items oi
          JOIN orders o ON o.id = oi.order_id
          LEFT JOIN products p ON p.id = oi.product_id
          WHERE o.status NOT IN ('cancelled')
          GROUP BY p.id, p.name, oi.product_id
          ORDER BY qty_sold DESC
          LIMIT 5
        `);

      const [recentCustomers] =
        await pool.query(`
          SELECT
            u.id,
            u.name,
            u.email,
            u.created_at,
            (SELECT COUNT(*) FROM orders o WHERE o.user_id=u.id) AS orders_count,
            CAST((SELECT COALESCE(SUM(o.total_amount - o.discount),0) FROM orders o WHERE o.user_id=u.id AND o.status != 'cancelled') AS DOUBLE) AS total_spent
          FROM users u
          WHERE u.role='customer'
          ORDER BY u.created_at DESC
          LIMIT 5
        `);

      res.json({
        stats: {
          products:
            products.total,

          orders:
            orders.total,

          customers:
            customers.total,

          revenue:
            revenue.total,

          pendingOrders:
            pendingOrdersRow.total,
        },

        salesChart,

        orderStatusStats,

        lowStock,

        lowStockCount:
          lowStockCountRow.total,

        lowStockThreshold,

        recentOrders,

        ordersTrend,

        topProducts,

        recentCustomers,
      });

    } catch (err) {
      console.error(
        "DASHBOARD ERROR:",
        err
      );

      res.status(500).json({
        error:
          "Dashboard error",
      });
    }
  }
);

/* =====================================================
   BILLING
===================================================== */

app.get(
  "/api/billing",
  authRequired,
  adminOnly,
  async (req, res) => {
    try {
      const {
        from,
        to,
      } = req.query;

      if (!from || !to) {
        return res.status(400).json({
          error:
            "Please provide from and to date",
        });
      }

      const validStatus = [
        "confirmed",
        "processing",
        "shipped",
        "delivered",
      ];

      const [orders] =
        await pool.query(
          `
          SELECT
            o.id,

            COALESCE(
              u.name,
              o.customer_name
            ) AS customer,

            o.total_amount,

            o.status,

            DATE_FORMAT(
              o.created_at,
              '%d %b %Y'
            ) AS date

          FROM orders o

          LEFT JOIN users u
          ON u.id=o.user_id

          WHERE DATE(o.created_at)
          BETWEEN ? AND ?

          AND o.status IN (?)

          ORDER BY
          o.created_at DESC
          `,
          [
            from,
            to,
            validStatus,
          ]
        );

      const [[summary]] =
        await pool.query(
          `
          SELECT
            COUNT(*) AS totalOrders,

            COALESCE(
              SUM(total_amount),
              0
            ) AS totalRevenue

          FROM orders

          WHERE DATE(created_at)
          BETWEEN ? AND ?

          AND status IN (?)
          `,
          [
            from,
            to,
            validStatus,
          ]
        );

      res.json({
        success: true,

        range: {
          from,
          to,
        },

        summary,

        orders,
      });

    } catch (err) {
      console.error(
        "BILLING ERROR:",
        err
      );

      res.status(500).json({
        success: false,
        error:
          "Billing fetch failed",
      });
    }
  }
);

/* =====================================================
   HEALTH ENDPOINT
===================================================== */

app.get("/api/health", async (req, res) => {
  const startedAt = Date.now();
  const uptime = Math.floor(process.uptime());

  try {
    await pool.query("SELECT 1");
    res.json({
      status: "ok",
      service: "oms-dms-backend",
      uptime,
      database: "connected",
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(503).json({
      status: "degraded",
      service: "oms-dms-backend",
      uptime,
      database: "unavailable",
      timestamp: new Date().toISOString(),
    });
  }
});

/* =====================================================
   HOME API
===================================================== */

app.get("/", (req, res) => {
  res.json({
    status: "success",
    message:
      "OMS + DMS Backend API is running",
  });
});

/* =====================================================
   404 HANDLER
===================================================== */

app.use((req, res) => {
  res.status(404).json({
    error: `Cannot ${req.method} ${req.originalUrl}`,
  });
});

/* =====================================================
   ERROR HANDLER
   - Keeps responses JSON and free of stack traces / internals.
   - Handles multer + body-parser limits explicitly.
===================================================== */

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err && err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "File too large. Maximum size is 5 MB." });
  }

  if (err && err.type === "entity.too.large") {
    return res.status(413).json({ error: "Request body too large" });
  }

  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: "Invalid upload" });
  }

  if (err && err.message && /Only JPEG|File type not allowed|valid image/i.test(err.message)) {
    return res.status(400).json({ error: err.message });
  }

  if (err && Number.isInteger(err.status) && err.status >= 400 && err.status < 600) {
    return res.status(err.status).json({ error: err.message || "Request failed" });
  }

  console.error("UNHANDLED ERROR:", err && err.message);
  return res.status(500).json({ error: "Internal server error" });
});

/* =====================================================
   START SERVER
===================================================== */

const PORT = Number(process.env.PORT) || 5000;

app.listen(PORT, () => {
  console.log(
    `ðŸš€ Server running on http://localhost:${PORT}`
  );
});
