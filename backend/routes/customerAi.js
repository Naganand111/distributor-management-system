/* =====================================================
   CUSTOMER AI ASSISTANT ROUTES
   -----------------------------------------------------
   Self-service assistant for the customer portal.

   SECURITY MODEL
   - The customer identity comes ONLY from the verified JWT
     (req.user.id). No customerId / userId / email is ever read
     from the request, so the UI cannot impersonate anyone.
   - Every query is scoped with `o.user_id = ?` inside the SQL,
     so a customer can never read another customer's records.
   - No company-wide or admin metric is selectable at all.
   - Read-only: SELECT statements only, fixed SQL text, bound
     values only.
   ===================================================== */

import express from "express";
import rateLimit from "express-rate-limit";
import { aiRegistry, detectPeriod } from "../services/ai/index.js";
import { answerWithLlm, sealPrecomputedToolResult } from "../services/ai/orchestrator.js";

const MAX_MESSAGE_LENGTH = 2000;
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;

/* Exact wording required when a customer asks for company/admin data. */
const SCOPE_ANSWER =
  "I can help with information related to your account, orders, payments and purchases.";

/* Company / admin / other-customer topics: never answered here. */
const ADMIN_TOPIC =
  /\b(company|business)\b|\brevenue\b|\bprofit\b|\bmargin\b|\ball customers?\b|\bother customers?\b|\bevery customer\b|\ball orders\b|\bother (customer|client|user)s?\b|\binventory\b|\bstock levels?\b|\bsales ?rep|\bsalesman\b|\badmin\b|\breports?\b|\brecommendations?\b|\bsuggestions?\b|\bforecast|\bpredictions?\b|\bperformance\b|\btop products?\b|\bbest selling\b|\bslowest\b|\breorder\b|\brestock|\bexpir\w*\b|\bdamaged\b|\bretailers?\b|\bterritories\b|\btargets?\b|\battainment\b/;

const FALLBACK_ANSWER =
  "I can help with your orders, payments, invoices and purchase history. Try asking for your orders, your latest order, your payments, your invoices, or your recent purchases.";

const money = (n) =>
  "₹" + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const shortDate = (v) => {
  if (!v) return "";
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return String(v).slice(0, 10);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

const titleCase = (s) =>
  String(s || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const bulletList = (lines) => lines.filter(Boolean).map((l) => `• ${l}`).join("\n");

/* Order lines can carry a NULL / blank name, quantity or price (legacy or
   partially imported rows). Render a plain label instead of the words
   "null"/"undefined" or a fabricated "₹0.00". Fully populated lines are
   rendered exactly as before. */
const itemName = (v) =>
  v === null || v === undefined || String(v).trim() === "" ? "Unnamed item" : String(v);
const itemQty = (v) =>
  v === null || v === undefined || String(v).trim() === "" ? "qty unavailable" : String(v);
const itemPrice = (v) => {
  if (v === null || v === undefined || String(v).trim() === "") return "price unavailable";
  return Number.isFinite(Number(v)) ? money(v) : "price unavailable";
};

export default function registerCustomerAiRoutes(app, pool, authRequired) {
  /* Customers only: the admin has a separate assistant. */
  const requireCustomer = (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Authentication required" });
    if (req.user.role !== "customer") {
      return res.status(403).json({ error: "Customer access only" });
    }
    next();
  };

  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 60,
    message: { error: "Too many assistant requests. Please try again in 15 minutes." },
    standardHeaders: true,
    legacyHeaders: false,
  });

  /* Conversation history is read-heavy: the panel reloads it whenever it is
     opened, so it gets a higher ceiling than a query, but it is still bounded
     so the endpoints cannot be used to hammer the database. */
  const conversationReadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 120,
    message: {
      error: "Too many conversation requests. Please try again in 15 minutes.",
    },
    standardHeaders: true,
    legacyHeaders: false,
  });

  /* Deleting a conversation removes its messages too, so it is destructive and
     gets a tighter ceiling than the read endpoints. */
  const conversationDeleteLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    message: {
      error: "Too many conversation deletions. Please try again in 15 minutes.",
    },
    standardHeaders: true,
    legacyHeaders: false,
  });

  const router = express.Router();

  /* =====================================================
     Input helpers
  ===================================================== */

  function extractLimit(msg) {
    const m = msg.match(
      /\b(?:top|first|last|latest|show|list)?\s*(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/
    );
    if (!m) return DEFAULT_LIMIT;
    const words = {
      one: 1, two: 2, three: 3, four: 4, five: 5,
      six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    };
    const n = words[m[1]] || parseInt(m[1], 10);
    if (!Number.isFinite(n)) return DEFAULT_LIMIT;
    return Math.min(MAX_LIMIT, Math.max(1, n));
  }

  /* Optional period filter, still bound to the caller's own orders.
     The question is mapped to a period *name* only; the matching SQL
     fragment lives in services/ai/tools/customer/periods.js so a customer
     can never influence the query text. */
  const CUSTOMER_TOOL_ARG_BUILDERS = Object.freeze({
    my_orders: (msg) => ({ limit: extractLimit(msg), period: detectPeriod(msg) }),
    recent_purchases: (msg) => ({ limit: extractLimit(msg), period: detectPeriod(msg) }),
    my_payments: (msg) => ({ limit: extractLimit(msg) }),
    my_invoices: (msg) => ({ limit: extractLimit(msg) }),
  });

  /* Reads the recent turns of a conversation. The conversation id is always
     re-checked against the caller's user_id here, so a guessed id can never
     expose another customer's history. */
  async function loadContext(convId, userId) {
    const [rows] = await pool.query(
      `SELECT m.role, m.content, m.meta
       FROM ai_messages m
       JOIN ai_conversations c ON c.id = m.conversation_id
       WHERE m.conversation_id=? AND c.user_id=?
       ORDER BY m.id DESC
       LIMIT 12`,
      [convId, userId]
    );
    const messages = rows.reverse();
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
    let meta = null;
    if (lastAssistant && lastAssistant.meta) {
      try {
        meta = typeof lastAssistant.meta === "string" ? JSON.parse(lastAssistant.meta) : lastAssistant.meta;
      } catch {
        meta = null;
      }
    }
    return {
      messages,
      prevIntent: (meta && meta.intent) || null,
      prevData: (meta && meta.data) || null,
      /* Which single order the previous turn was about, so that
         "How much was it?" keeps referring to the same order. */
      focusOrderId: (meta && meta.focusOrderId) || null,
    };
  }

  /* =====================================================
     Intent detection (deterministic, no external LLM)
  ===================================================== */

  function detectIntent(msg) {
    const m = msg.toLowerCase();

    /* Out of scope first: company/admin data is refused, never answered. */
    if (ADMIN_TOPIC.test(m)) return "out_of_scope";

    /* Tracking is checked first: "my latest order" is a single-order
       lookup, while "my orders" is a list. */
    if (
      /\b(track|tracking)\b.*\border\b/.test(m) ||
      /\border\b.*\b(track|tracking)\b/.test(m) ||
      /\b(where is|what is the status of|status of|follow)\b.*\border\b/.test(m) ||
      /\border\b.*\b(where is it|status)\b/.test(m) ||
      /\bmy (latest|last|most recent) order\b/.test(m) ||
      /\b(latest|last|most recent) order\b/.test(m)
    ) {
      return "track_order";
    }

    if (
      /\border history\b/.test(m) ||
      /\bshow (me )?(all )?(my )?orders\b/.test(m) ||
      /\bwhat orders\b/.test(m) ||
      /\bmy orders?\b/.test(m)
    ) {
      return "my_orders";
    }

    if (
      /\bmy payments?\b/.test(m) ||
      /\bpayments?\b.*\b(my|me|i)\b/.test(m) ||
      /\bhow much (did i|have i) (pay|paid)\b/.test(m) ||
      /\bpayment (status|history|summary)\b/.test(m) ||
      /\b(outstanding|due)\b.*\b(payment|pay)\b/.test(m)
    ) {
      return "my_payments";
    }

    if (/\bmy invoices?\b/.test(m) || /\binvoices?\b.*\b(my|me|i)\b/.test(m) || /\bbills?\b/.test(m)) {
      return "my_invoices";
    }

    if (
      /\brecent purchases?\b/.test(m) ||
      /\bpurchase history\b/.test(m) ||
      /\bwhat (did i|have i) (buy|bought|purchase)\b/.test(m) ||
      /\bmy purchases?\b/.test(m)
    ) {
      return "recent_purchases";
    }

    if (
      /\bhow many orders\b/.test(m) ||
      /\btotal spent\b/.test(m) ||
      /\bhow much (have i|did i) spend\b/.test(m) ||
      /\bmy (order )?summary\b/.test(m) ||
      /\bhow (are|is) my orders\b/.test(m)
    ) {
      return "my_order_summary";
    }

    if (/\bmy (account|profile|details)\b/.test(m) || /\bwho am i\b/.test(m)) {
      return "my_profile";
    }

    return null;
  }

  /* Follow-ups that reuse the previous answer instead of re-asking. */
  function detectFollowUp(msg, context) {
    const m = msg.toLowerCase();
    const prev = context && context.prevIntent;
    const prevData = context && context.prevData;
    if (!prev) return null;

    const listIntents = ["my_orders", "recent_purchases", "track_order"];
    const hasOrders = prevData && Array.isArray(prevData.orders) && prevData.orders.length > 0;

    if (listIntents.includes(prev) && hasOrders) {
      if (/\b(status|how is it going|where is it)\b/.test(m) && /\b(first|1st|one|last|latest|it|that)\b/.test(m)) {
        return { intent: prev, data: prevData, viaContext: true };
      }
      if (/\bhow much\b|\bwhat (was|is) the (amount|total|price)\b|\bcost\b|\bprice\b/.test(m)) {
        return { intent: prev, data: prevData, viaContext: true };
      }
      if (/\bitems?\b|\bproducts?\b|\bwhat did i (order|buy)\b/.test(m)) {
        return { intent: prev, data: prevData, viaContext: true };
      }
    }

    if (listIntents.includes(prev) || prev === "my_order_summary") {
      if (/\binvoice/.test(m)) return { intent: "my_invoices", viaContext: true };
      if (/\bpayment/.test(m)) return { intent: "my_payments", viaContext: true };
    }

    if (/\b(again|more|others?)\b/.test(m) && hasOrders) {
      return { intent: prev, data: prevData, viaContext: true };
    }

    return null;
  }

  /* =====================================================
     Executors — every statement is a SELECT bound to the
     caller's own user id taken from the JWT.
  ===================================================== */

/* =====================================================
     TOOL EXECUTION
     Each intent is served by a registered customer tool in
     backend/services/ai/tools/customer. The registry takes the caller's
     identity from the verified JWT only, validates arguments and refuses
     anything but read-only SQL. Intents without a tool (out_of_scope,
     fallback) return null so the existing refusal wording is unchanged.
  ===================================================== */

  async function runCustomerTool(intent, actor, msg) {
    const toolName = aiRegistry.toolNameForIntent(intent);

    if (!toolName) return null;

    const buildArgs = CUSTOMER_TOOL_ARG_BUILDERS[intent] || (() => ({}));

    const executed = await aiRegistry.execute({
      toolName,
      intent,
      actor,
      db: pool,
      args: buildArgs(msg),
    });

    return executed.data;
  }

  /* =====================================================
     Narration — plain text built only from returned values
  ===================================================== */

  function narrate(intent, data) {
    const d = data || {};

    if (intent === "out_of_scope") return SCOPE_ANSWER;

    if (intent === "my_orders" || intent === "track_order") {
      const orders = d.orders || [];
      if (!orders.length) {
        return intent === "track_order"
          ? "You do not have any orders yet, so there is nothing to track."
          : `You do not have any orders${d.period ? ` ${d.period}` : ""} yet.`;
      }

      if (intent === "track_order") {
        const o = orders[0];
        const lines = [
          `Date: ${shortDate(o.created_at)}`,
          `Status: ${titleCase(o.status)}`,
          `Items: ${o.item_count}`,
          `Total: ${money(Number(o.total_amount) - Number(o.discount || 0))}`,
          `Payment: ${titleCase(o.payment_status)}`,
        ];
        if (o.invoice_no) lines.push(`Invoice: ${o.invoice_no}`);
        const items = (d.items || []).map(
          (i) => `${itemName(i.name)} — ${itemQty(i.quantity)} × ${itemPrice(i.price)}`
        );
        if (items.length) lines.push("", "Items:", ...items.map((i) => `• ${i}`));
        const history = d.history || [];
        if (history.length) {
          lines.push("", "Progress:", ...history.map((h) => `• ${titleCase(h.status)} — ${shortDate(h.created_at)}`));
        }
        return `Here is the status of your latest order:\n\n${lines.join("\n")}`;
      }

      const header = d.period
        ? `Here are your recent orders ${d.period}:`
        : "Here are your recent orders:";
      const body = orders
        .map(
          (o) =>
            `• Order #${o.id} — ${shortDate(o.created_at)} — ${titleCase(o.status)} — ` +
            `${money(Number(o.total_amount) - Number(o.discount || 0))} — ${o.item_count} item(s)`
        )
        .join("\n");
      return `${header}\n${body}`;
    }

    if (intent === "my_payments") {
      const s = d.summary;
      const payments = Array.isArray(d.payments) ? d.payments : [];

      /* A context-only follow-up ("what about payment?") can reach narrate()
         before any payment lookup ran, so the data may be absent entirely
         (undefined/null) or be a partial result without a summary. Saying so
         plainly avoids printing "Orders: undefined" or inventing zero values.
         Valid and genuine zero-payment results keep the exact wording below. */
      const missingData =
        !s ||
        typeof s !== "object" ||
        s.paid === undefined ||
        s.paid === null ||
        s.outstanding === undefined ||
        s.outstanding === null ||
        s.orders === undefined ||
        s.orders === null ||
        !Array.isArray(d.payments);
      if (missingData) {
        return "I could not load your payment details just now. Please try asking again.";
      }

      const head =
        `Payment summary for your account:\n\n` +
        bulletList([
          `Paid: ${money(s.paid)}`,
          `Outstanding: ${money(s.outstanding)}`,
          `Orders: ${s.orders}`,
        ]);
      if (!payments.length) return `${head}\n\nNo payment records have been recorded yet.`;
      const body = payments
        .map(
          (p) =>
            `• ${money(p.amount)} — ${titleCase(p.method || "payment")} — order #${p.order_id} — ${shortDate(p.payment_date)}`
        )
        .join("\n");
      return `${head}\n\nRecent payments:\n${body}`;
    }

    if (intent === "my_invoices") {
      const s = d.summary;
      const invoices = Array.isArray(d.invoices) ? d.invoices : [];

      /* A context-only follow-up ("does it have an invoice?") can reach
         narrate() before any invoice lookup ran, so the data may be absent
         entirely (undefined/null). Say so plainly instead of rendering
         summary lines that would print the word "undefined". Valid and empty
         results keep the exact wording below. */
      const missingData =
        !s ||
        typeof s !== "object" ||
        s.invoices === undefined ||
        s.invoices === null ||
        !Array.isArray(d.invoices);
      if (missingData) {
        return "I could not load your invoice details just now. Please try asking again.";
      }

      const head =
        `Invoice summary:\n\n` +
        bulletList([
          `Invoices: ${s.invoices}`,
          `Total invoiced: ${money(s.invoiced_total)}`,
        ]);
      if (!invoices.length) return `${head}\n\nYou do not have any invoices yet.`;
      const body = invoices
        .map(
          (i) =>
            `• ${i.invoice_no} — order #${i.order_id} — ${shortDate(i.invoice_date)} — ${money(i.grand_total)} — ${titleCase(i.payment_status)}`
        )
        .join("\n");
      return `${head}\n\nYour invoices:\n${body}`;
    }

    if (intent === "recent_purchases") {
      const orders = d.orders || [];
      if (!orders.length) {
        return `You do not have any purchases${d.period ? ` ${d.period}` : ""} yet.`;
      }
      const lines = orders.map((o) => {
        const items = (d.items && d.items[o.id]) || [];
        const detail = items.length
          ? items.map((i) => `${itemName(i.name)} (${itemQty(i.quantity)})`).join(", ")
          : "no item details recorded";
        return `• Order #${o.id} — ${shortDate(o.created_at)} — ${money(Number(o.total_amount) - Number(o.discount || 0))}\n  ${detail}`;
      });
      return `Here are your recent purchases${d.period ? ` ${d.period}` : ""}:\n\n${lines.join("\n")}`;
    }

    if (intent === "my_order_summary") {
      const s = d.summary;

      /* A context-only follow-up can reach narrate() before the spending-summary
         tool ran, so the data may be absent entirely (undefined/null) or be a
         partial result. Saying so plainly avoids printing "Total orders:
         undefined" or inventing zero counts. Genuine zero-order results from
         the tool keep the exact wording below. */
      const requiredSummaryFields = [
        "total_orders", "pending", "processing", "shipped",
        "delivered", "cancelled", "total_spent",
      ];
      const missingData =
        !s ||
        typeof s !== "object" ||
        requiredSummaryFields.some(
          (key) => s[key] === undefined || s[key] === null
        );
      if (missingData) {
        return "I could not load your order summary just now. Please try asking again.";
      }

      return (
        `Here is a summary of your orders:\n\n` +
        bulletList([
          `Total orders: ${s.total_orders}`,
          `Pending: ${s.pending}`,
          `Processing: ${s.processing}`,
          `Shipped: ${s.shipped}`,
          `Delivered: ${s.delivered}`,
          `Cancelled: ${s.cancelled}`,
          `Total spent: ${money(s.total_spent)}`,
          s.last_order_at ? `Last order: ${shortDate(s.last_order_at)}` : null,
        ]) +
        `\n\nSource: orders.total_amount (booked order value, less discount).`
      );
    }

    if (intent === "my_profile") {
      const p = d.profile;
      if (!p) return "I could not load your account details.";
      return (
        `Your account details:\n\n` +
        bulletList([
          p.name ? `Name: ${p.name}` : null,
          p.email ? `Email: ${p.email}` : null,
          p.mobile ? `Mobile: ${p.mobile}` : null,
          p.city ? `City: ${p.city}` : null,
          p.state ? `State: ${p.state}` : null,
        ])
      );
    }

    return FALLBACK_ANSWER;
  }

  /* Resolves which order a follow-up refers to. The order list is returned
     newest-first, so "the first one" is the top row. Pronouns such as "it"
     keep pointing at the order the previous turn talked about. */
  function resolveOrderRef(msg, context) {
    const d = (context && context.prevData) || {};
    const orders = Array.isArray(d.orders) ? d.orders : [];
    if (!orders.length) return null;
    const m = String(msg || "").toLowerCase();

    const pick = (index) => (orders[index] ? orders[index].id : null);
    const nth = m.match(/\b(second|2nd|third|3rd|fourth|4th)\b/);
    if (nth) {
      return pick({ second: 1, "2nd": 1, third: 2, "3rd": 2, fourth: 3, "4th": 3 }[nth[1]]);
    }
    if (/\b(last)\b/.test(m)) return pick(orders.length - 1);
    if (/\b(first|1st|one)\b/.test(m)) return pick(0);
    if (/\b(latest|most recent|newest)\b/.test(m)) return pick(0);
    /* "it", "that order", "how much was it?" -> stay on the same order. */
    if (context.focusOrderId && orders.some((o) => o.id === context.focusOrderId)) {
      return context.focusOrderId;
    }
    return pick(0);
  }

  function followUpAnswer(msg, context) {
    const d = context.prevData || {};
    const orders = Array.isArray(d.orders) ? d.orders : [];
    if (!orders.length) return null;
    const refId = resolveOrderRef(msg, context);
    const o = orders.find((x) => x.id === refId) || orders[0];
    const m = String(msg || "").toLowerCase();
    const total = money(Number(o.total_amount) - Number(o.discount || 0));

    if (/\bhow much\b|\bamount\b|\btotal\b|\bprice\b|\bcost\b/.test(m)) {
      return `Order #${o.id} came to ${total}.`;
    }
    if (/\bitems?\b|\bproducts?\b|\bwhat did i\b/.test(m)) {
      const items = (d.items && (d.items[o.id] || d.items)) || [];
      const list = Array.isArray(items) && items.length
        ? items.map((i) => `${itemName(i.name)} — ${itemQty(i.quantity)} × ${itemPrice(i.price)}`).join("\n")
        : "No item details are recorded for that order.";
      return `Order #${o.id} includes:\n${list}`;
    }
    if (/\bstatus\b|\bwhere is\b|\btrack/.test(m)) {
      return `Order #${o.id} is currently ${titleCase(o.status)} and its payment is ${titleCase(o.payment_status)}.`;
    }
    if (/\binvoice/.test(m)) {
      return o.invoice_no
        ? `Order #${o.id} has invoice ${o.invoice_no}.`
        : `No invoice has been generated for order #${o.id} yet.`;
    }
    return `Order #${o.id} is ${titleCase(o.status)}, placed on ${shortDate(o.created_at)}, for a total of ${total}.`;
  }

  /* =====================================================
     POST /api/customer-ai/query
  ===================================================== */

  router.post("/query", limiter, async (req, res) => {
    try {
      const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
      if (!message) return res.status(400).json({ error: "Message is required" });
      if (message.length > MAX_MESSAGE_LENGTH) {
        return res.status(413).json({ error: `Message must be ${MAX_MESSAGE_LENGTH} characters or fewer` });
      }

      /* Identity is taken from the JWT only. Any customerId / userId /
         email in the body is deliberately ignored. */
      const userId = req.user.id;

      let conversationId = null;
      const requested = Number(req.body?.conversationId);
      if (Number.isInteger(requested) && requested > 0) {
        const [owned] = await pool.query(
          "SELECT id FROM ai_conversations WHERE id=? AND user_id=?",
          [requested, userId]
        );
        if (owned.length) conversationId = requested;
      }

      if (!conversationId) {
        const [conv] = await pool.query(
          "INSERT INTO ai_conversations (user_id, title) VALUES (?, ?)",
          [userId, message.slice(0, 80)]
        );
        conversationId = conv.insertId;
      }

      const context = await loadContext(conversationId, userId);
      const lower = message.toLowerCase();

      let intent = detectIntent(message);
      let data = null;
      let viaContext = false;

      if (intent === "out_of_scope") {
        data = null;
      } else if (intent) {
        /* actor.userId comes from the verified JWT via requireCustomer.
           The tools re-check it against their own WHERE clause. */
        data = await runCustomerTool(intent, { userId, role: req.user.role }, message);
      } else {
        const followUp = detectFollowUp(lower, context);
        if (followUp) {
          intent = followUp.intent;
          data = followUp.data;
          viaContext = true;
        }
      }

      let answer;
      let focusOrderId = null;
      if (intent === "out_of_scope") {
        answer = SCOPE_ANSWER;
      } else if (viaContext) {
        /* A follow-up ("How much was it?") must answer from the previous
           result instead of repeating the whole list. */
        answer = followUpAnswer(lower, context) || narrate(intent, data);
        focusOrderId = resolveOrderRef(lower, context);
      } else if (data) {
        answer = narrate(intent, data);
        /* A single-order answer focuses that order for the next turn. */
        if (Array.isArray(data.orders) && data.orders.length === 1) focusOrderId = data.orders[0].id;
      } else {
        const ctx = followUpAnswer(lower, context);
        answer = ctx || FALLBACK_ANSWER;
        focusOrderId = resolveOrderRef(lower, context);
      }

      /* Phase 5: the LLM may narrate this answer for a customer, within a strict time budget.
         It runs only for a tool-backed customer intent, only through the Phase 1
         registry, and only for the customer tool detectIntent() already selected,
         bound strictly to req.user.id.

         answerWithLlm() never throws and never returns text unless it succeeded,
         so every failure - disabled, misconfigured, timed out, refused or
         malformed - leaves answer exactly as the deterministic layer computed it.

         Only the direct detectIntent() branch qualifies: a tool ran for this
         caller (data), the intent was not borrowed from conversation context,
         and the orchestrator re-checks the role against the Phase 1 registry
         before a single provider call is made. */
      if (!viaContext && data) {
        const llm = await answerWithLlm({
          actor: { userId: req.user.id, role: req.user.role },
          message,
          db: pool,
          surface: "customer",
          deterministicIntent: intent,
          /* `data` is this caller's own tool result (scoped to req.user.id).
             Sealing it here keeps it out of reach of any HTTP request field. */
          precomputedResult: sealPrecomputedToolResult(
            aiRegistry.toolNameForIntent(intent),
            data
          ),
        });

        if (llm.ok && llm.text) {
          answer = llm.text;
        }
      }

      await pool.query(
        "INSERT INTO ai_messages (conversation_id, role, content) VALUES (?, 'user', ?)",
        [conversationId, message]
      );
      await pool.query(
        "INSERT INTO ai_messages (conversation_id, role, content, meta) VALUES (?, 'assistant', ?, ?)",
        [conversationId, answer, JSON.stringify({ intent: intent || "fallback", data, focusOrderId })]
      );
      await pool.query("UPDATE ai_conversations SET updated_at=NOW() WHERE id=?", [conversationId]);

      res.json({
        success: true,
        data: { answer, data, intent: intent || "fallback", conversationId, focusOrderId },
      });
    } catch (err) {
      console.error("CUSTOMER AI QUERY ERROR:", err);
      res.status(500).json({ error: "Failed to process your question" });
    }
  });

  /* =====================================================
     Conversations (always scoped to the caller)
  ===================================================== */

  router.get(
    "/conversations",
    conversationReadLimiter,
    async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT c.id, c.title, c.updated_at,
                (SELECT COUNT(*) FROM ai_messages m WHERE m.conversation_id=c.id) AS message_count
         FROM ai_conversations c
         WHERE c.user_id=?
         ORDER BY c.updated_at DESC, c.id DESC
         LIMIT 30`,
        [req.user.id]
      );
      res.json(rows);
    } catch (err) {
      console.error("CUSTOMER AI CONVERSATIONS ERROR:", err);
      res.status(500).json({ error: "Failed to load conversations" });
    }
  }
  );

  router.get(
    "/conversations/:id/messages",
    conversationReadLimiter,
    async (req, res) => {
    try {
      /* Take the latest 100 owned rows, then order them chronologically. The
         JOIN keeps the caller's ownership check in the same statement, and the
         explicit column list matches the response shape from before. */
      const [rows] = await pool.query(
        `SELECT recent.id, recent.role, recent.content, recent.meta, recent.created_at
         FROM (
           SELECT m.id, m.role, m.content, m.meta, m.created_at
           FROM ai_messages m
           JOIN ai_conversations c ON c.id=m.conversation_id
           WHERE m.conversation_id=? AND c.user_id=?
           ORDER BY m.id DESC
           LIMIT 100
         ) AS recent
         ORDER BY recent.id ASC`,
        [Number(req.params.id), req.user.id]
      );
      if (!rows.length) return res.status(404).json({ error: "Conversation not found" });
      res.json(rows);
    } catch (err) {
      console.error("CUSTOMER AI MESSAGES ERROR:", err);
      res.status(500).json({ error: "Failed to load messages" });
    }
  }
  );

  router.delete(
    "/conversations/:id",
    conversationDeleteLimiter,
    async (req, res) => {
    try {
      const [result] = await pool.query(
        "DELETE FROM ai_conversations WHERE id=? AND user_id=?",
        [Number(req.params.id), req.user.id]
      );
      if (!result.affectedRows) return res.status(404).json({ error: "Conversation not found" });
      res.json({ success: true });
    } catch (err) {
      console.error("CUSTOMER AI DELETE ERROR:", err);
      res.status(500).json({ error: "Failed to delete conversation" });
    }
  }
  );

  app.use("/api/customer-ai", authRequired, requireCustomer, router);
}
