import express from "express";
import rateLimit from "express-rate-limit";
import { aiRegistry } from "../services/ai/index.js";
import { answerWithLlm, sealPrecomputedToolResult } from "../services/ai/orchestrator.js";

const AI_MAX_MESSAGE_LENGTH = 2000;

const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { error: "Too many AI requests. Please try again in 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

/* Conversation history is read-heavy: the UI reloads it on every open, so it
   gets a higher ceiling than a query, but it is still bounded so the list and
   message endpoints cannot be used to hammer the database. */
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

export default function registerAiRoutes(app, pool, authRequired, adminOnly) {
  const router = express.Router();

  /* Every AI conversation is scoped to the authenticated admin
     (req.user.id) so admins can never see each other's history. */

  /* =====================================================
     INTENT DETECTION — keyword-based NLP engine
  ===================================================== */

  function detectIntent(message) {
    const msg = message.toLowerCase().trim();

    const hasPeriod = /\b(today|yesterday|this month|last month|previous month)\b/.test(
      msg
    );

    /* ---------- Not supported by the existing query set ---------- */
    if (
      /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\s*(st|nd|rd|th)?\s*(of\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(
        msg
      )
    ) {
      return { intent: "clarification", clarify: "date", answer: "date_scope" };
    }

    /* =====================================================
       PHASE 5 — BUSINESS INTELLIGENCE
       Placed ahead of the older blocks on purpose: these phrasings would
       otherwise be swallowed by product_overview / business_summary /
       total_customers / business_alerts, and the existing intents keep
       their own triggers.
    ===================================================== */

    /* Inventory health. Guarded so "inventory value" / "stock value"
       still resolves to the existing inventory_value intent. */
    if (
      /inventory health|inventory status|inventory (overview|insights?|report|summary|condition|position)|how (is|are) (our |the )?inventory\b|how'?s (our |the )?inventory\b|how is (our |the )?stock\b|what inventory needs attention|inventory (needs|require|required).*attention|stock health|how healthy is (our |the )?(inventory|stock)/.test(
        msg
      ) &&
      !/\b(inventory|stock) value\b/.test(msg)
    ) {
      return { intent: "inventory_health", answer: "inventory_health" };
    }

    /* Customer insights. Must precede total_customers, which matches any
       message containing the word "customer". */
    if (
      /customer (overview|insights?|insight|report|summary|health|analysis|breakdown)|how (are|is) (our |the )?customers?\b|how'?s (our |the )?customers?\b|our customer base|insights? (about|on|into) (our |the )?customers?|give me customer/.test(
        msg
      )
    ) {
      return { intent: "customer_overview", answer: "customer_overview" };
    }

    /* Sales trend. Must precede the ambiguous "how are sales" check.
       Forecast wording is refused rather than answered. */
    if (
      /sales trend|sales trending|trending|trend in sales|sales over (time|the last few|the past)|how (are|is) sales trending|how have sales|recent sales trend/.test(
        msg
      ) &&
      !/forecast|predict|projection|project|expect|will (be|be sold)|next month|coming month/.test(
        msg
      )
    ) {
      return { intent: "sales_trend", answer: "sales_trend" };
    }

    /* Week-scoped sales. Must precede the daily/monthly blocks and the
       ambiguous "how are sales" check so a week period is never answered
       with today's figures or a clarification. The negative guard keeps
       week-scoped questions about other topics (inventory reports,
       overviews, status, ...) on their existing intents, and explicit
       dates remain refused above. */
    if (
      /\b(this|the current|current|last|previous)\s+week\b|week to date\b/.test(msg) &&
      /(sale|revenue|order|performance|doing|how (?:did|have) (?:we|things))/.test(msg) &&
      !/\b(overview|insights?|report|summary|status|alerts?|health|recommendations?|trend)\b/.test(
        msg
      )
    ) {
      return /\b(last|previous)\s+week\b/.test(msg)
        ? { intent: "last_week_sales", answer: "last_week_sales" }
        : { intent: "this_week_sales", answer: "this_week_sales" };
    }

    /* Daily performance. Must precede business_summary ("today's business
       report", "how are we doing today"). */
    if (
      /(how did|how have) (we|things) (perform|do|go)\b|how (are|is) (we |we'?re )?doing today\b|today'?s? (business |daily )?(performance|report)\b|daily performance|how did today go|how'?s today (going|looking|performing)|today so far|how is today\b/.test(
        msg
      )
    ) {
      return { intent: "daily_performance", answer: "daily_performance" };
    }

    /* Monthly performance. Must precede business_summary and compare_months. */
    if (
      /monthly performance|month (performance|so far|to date)|how (are|is) (we |we'?re )?doing (this|the current) month|how (did|has) (this|the current) month (perform|gone|been|look)|this month'?s? (performance|report)\b|month to date|month-to-date/.test(
        msg
      )
    ) {
      return { intent: "monthly_performance", answer: "monthly_performance" };
    }

    /* Business recommendations. Deliberately narrower than business_alerts:
       it must not swallow a question that names a specific topic
       (reorder, low stock, payments, ...), and "what needs attention"
       stays with the existing business_alerts intent. */
    if (
      !/\b(reorder|reordering|restock|restocking|replenish|low stock|out of stock|expir\w*|damag\w*|payment|payments|unpaid|outstanding|overdue|invoice|invoices|retailer|retailers|sales rep|salesman|profit|margin|revenue|top \d|bottom \d|slow moving|best selling|worst|delivery|deliveries)\b/.test(
        msg
      ) &&
      /what should i (focus on|work on|do first|do now|be doing|be working on|prioriti[sz]e|take care of|look at)|give me (some )?recommendations|any recommendations|business recommendations|what recommendations|recommendations?\b|how can i improve|what can i improve/.test(
        msg
      )
    ) {
      return {
        intent: "business_recommendations",
        answer: "business_recommendations",
      };
    }

    /* ---------- Business insight overviews ---------- */
    if (
      /product (overview|insights?|report|summary)|how (are|is) (our |the )?products|products? (are |is )?(performing|doing)\b(?!.*\b(best|worst|lowest)\b)/.test(
        msg
      )
    ) {
      return { intent: "product_overview", answer: "product_overview" };
    }

    if (
      /payment (overview|insights?|report|summary|status)|payments? (are |is )?(looking|doing)\b|how (are|is) (our |the )?payments|payment status|payment issues|receivables?/.test(
        msg
      )
    ) {
      return { intent: "payment_overview", answer: "payment_overview" };
    }

    if (
      /order (overview|insights?|report|summary|status)|how (are|is) (our |the )?orders|order status|what'?s the order status/.test(
        msg
      )
    ) {
      return { intent: "order_overview", answer: "order_overview" };
    }

    if (
      /business alerts?|\balerts\b|anything i should (worry about|take care of|know about)|what needs (my |immediate )?attention|anything (that )?needs attention|what requires? attention|are there any problems|any problems\??|is there anything (wrong|i should)/.test(
        msg
      )
    ) {
      return { intent: "business_alerts", answer: "business_alerts" };
    }

    /* ---------- Sales questions are ambiguous without a period ---------- */
    if (
      !hasPeriod &&
      /sales (overview|insights?|report|summary)|how (are|is) (our |the )?sales|sales (are |is )?(doing|looking)\b|^sales\??$/.test(
        msg
      )
    ) {
      return { intent: "clarification", clarify: "sales", answer: "sales_scope" };
    }

    if (
      /business summary|business overview|business report|quick summary|quick business report|give me a summary|summary|overview|dashboard|how is the business|how are we doing|how'?s the business|what'?s happening today|today'?s business status/.test(
        msg
      )
    ) {
      return { intent: "business_summary", answer: "business_summary" };
    }

    if (
      /(compare|comparison).*month|this month.*last month|this month vs last month/.test(
        msg
      )
    ) {
      return { intent: "compare_months", answer: "monthly_comparison" };
    }

    if (
      /last month revenue|last month.*revenue|revenue.*last month/.test(msg)
    ) {
      return { intent: "last_month_revenue", answer: "last_month_revenue" };
    }

    if (
      /this month revenue|monthly revenue|revenue.*this month|this month.*revenue/.test(
        msg
      )
    ) {
      return { intent: "this_month_revenue", answer: "this_month_revenue" };
    }

    if (
      /today'?s?\s*(sale|sales|revenue)|today (sale|sales|revenue)|(sales?|revenue)( for)? today|today.*(sale|sales|sell|sold|revenue)|(sell|sold).*today/.test(
        msg
      )
    ) {
      return { intent: "todays_sales", answer: "todays_sales" };
    }

    if (
      /yesterday'?s?\s*(sale|sales|revenue)|yesterday (sale|sales|revenue)|(sales?|revenue)( for)? yesterday|yesterday.*(sale|sales|sell|sold|revenue)|(sell|sold).*yesterday/.test(
        msg
      )
    ) {
      return { intent: "yesterday_sales", answer: "yesterday_sales" };
    }

    if (
      /today'?s?\s*customers?|today customers|customers? today|customers?.*placed orders today|how many customers.*today|customers? who ordered today|customers?.*(ordered|placed).*(orders? )?today/.test(
        msg
      )
    ) {
      return { intent: "todays_customers", answer: "todays_customers" };
    }

    if (/gross profit|profit margin|profit|margin|after cost|net of cost|cost price/.test(msg)) {
      return { intent: "gross_profit", answer: "gross_profit" };
    }

    if (
      /sales rep|salesman|salesperson|sales person|sales representative|representative performance|rep performance/.test(
        msg
      )
    ) {
      return {
        intent: "sales_rep_performance",
        answer: "sales_rep_performance",
      };
    }

    if (
      /top.*product|best.*sell|best selling|top selling|top products|best products|sold the most|sell the most|most sold|sold most|best seller|best performers|performing best|highest selling|highest sales|selling the most|most selling|selling most/.test(
        msg
      )
    ) {
      return { intent: "top_products", answer: "top_products" };
    }

    if (
      /slow.*product|not selling|worst|slow moving|least sell|not moving|aren'?t moving|isn'?t moving|didn'?t sell|slowest|slow movers?|sell(ing)? (slow|poorly|badly)|bottom\b|lowest selling|lowest performing|performing (the )?lowest/.test(
        msg
      )
    ) {
      return { intent: "slow_products", answer: "slow_products" };
    }

    if (
      /low stock|out of stock|low in stock|low.?in.?stock|running low|running out|low on anything|low on any|low on stock|short on stock/.test(
        msg
      )
    ) {
      return { intent: "low_stock", answer: "low_stock" };
    }

    if (/inventory value|stock value|total stock value/.test(msg)) {
      return { intent: "inventory_value", answer: "inventory_value" };
    }

    if (
      /overdue|outstanding|pending payment|unpaid|payment.*pending|payment.*outstanding|payment.*unpaid|owes? us|owe us|still owe|money.*pending|money.*outstanding|money.*unpaid|money.*due/.test(
        msg
      )
    ) {
      return { intent: "overdue", answer: "overdue" };
    }

    if (/reorder|reorder level|reordering|restock|replenish|buy again|order again|need to buy/.test(msg)) {
      return { intent: "reorder", answer: "reorder" };
    }

    if (/expired|expiring|expiry/.test(msg)) {
      return { intent: "expired", answer: "expired" };
    }

    if (/damaged|damage/.test(msg)) {
      return { intent: "damaged", answer: "damaged" };
    }

    if (/top.*retailer|top.*customer|best.*retailer|best.*customer/.test(msg)) {
      return { intent: "top_retailers", answer: "top_retailers" };
    }

    if (
      /(how many|total number of|number of|total|customer count|show)\s*customers?/.test(
        msg
      ) ||
      /customers?/.test(msg)
    ) {
      return { intent: "total_customers", answer: "total_customers" };
    }

    if (/pending order|orders pending/.test(msg)) {
      return { intent: "pending_orders", answer: "pending_orders" };
    }

    if (/cancel.*order|cancelled order|order.*cancel/.test(msg)) {
      return { intent: "cancelled_orders", answer: "cancelled_orders" };
    }

    if (/today.*order|order.*today/.test(msg)) {
      return { intent: "todays_orders", answer: "todays_orders" };
    }

    if (
      /total order|total orders|all orders|how many orders|number of orders|how many total orders/.test(
        msg
      ) ||
      /^orders?$|^total orders?$/.test(msg)
    ) {
      return { intent: "total_orders", answer: "total_orders" };
    }

    if (
      /total revenue|total sales revenue|total revenue generated|overall revenue|total business revenue|total sales|show revenue|how much revenue|what is the revenue|how much sales|how much did we make|turnover|revenue/.test(
        msg
      )
    ) {
      return { intent: "total_revenue", answer: "total_revenue" };
    }

    return null;
  }

  /* =====================================================
     FORMATTING HELPERS
  ===================================================== */

  const num = (v) => Number(v || 0);

  const money = (v) =>
    "₹" +
    num(v).toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  const plural = (n, one, many) => `${num(n)} ${num(n) === 1 ? one : many}`;

  /* Legacy or partial rows can carry a NULL / blank name. Fall back to a
     neutral label instead of printing the word "null" or an empty ranking
     entry. Populated names are returned verbatim. */
  const displayName = (value, fallback) => {
    if (value === null || value === undefined) return fallback;
    const text = String(value).trim();
    return text ? text : fallback;
  };

  const pct = (v) => `${num(v).toFixed(1)}%`;

  /* Percentage change, or null when there is no previous figure to compare
     against. Returning null keeps a fabricated "0%" or "Infinity%" out of
     the narration. */
  const changePct = (current, previous) => {
    const c = num(current);
    const p = num(previous);
    if (p === 0) return null;
    return ((c - p) / p) * 100;
  };

  const directionWord = (delta) =>
    delta > 0 ? "up" : delta < 0 ? "down" : "unchanged";

  /* "05 Sep" — used for recorded sales days. */
  const shortDate = (v) => {
    if (!v) return "";
    const d = v instanceof Date ? v : new Date(v);
    if (Number.isNaN(d.getTime())) return String(v);
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  };

  const bulletList = (items) => items.map((t) => `• ${t}`).join("\n");

  const numbered = (rows, limit, describe) =>
    (Array.isArray(rows) ? rows : [])
      .slice(0, limit || 10)
      .map((r, i) => `${i + 1}. ${describe(r)}`)
      .join("\n");

  const FALLBACK_ANSWER =
    "I can help you with sales and revenue (today, yesterday, this week, last week, this month, last month, or all time), profit and margin, orders, customers, products, stock levels, reordering, expiries, damaged inventory, outstanding payments, sales-rep performance, your top customers, inventory health, today's and this month's performance, the sales trend, customer insights, and evidence-based recommendations. Try asking something like \"How is inventory?\", \"How did we perform today?\", \"How are we doing this month?\", \"Show sales trend\", \"Give me customer insights\", or \"What should I focus on?\"";

  /* A single, evidence-based "attention" sentence. Only mentions
     conditions that the snapshot actually shows as non-zero. */
  function attentionLine(d) {
    const bits = [];

    if (num(d.low_stock) > 0) {
      bits.push(
        `${plural(
          d.low_stock,
          "product is",
          "products are"
        )} below the low-stock threshold`
      );
    }
    if (num(d.reorder_items) > 0) {
      bits.push(
        `${plural(
          d.reorder_items,
          "product is",
          "products are"
        )} at or below the reorder level`
      );
    }
    if (num(d.expired_products) > 0) {
      bits.push(
        `${plural(
          d.expired_products,
          "product has",
          "products have"
        )} expired`
      );
    }
    if (num(d.damaged_recent) > 0) {
      bits.push(
        `${plural(
          d.damaged_recent,
          "damaged inventory record has",
          "damaged inventory records have"
        )} been logged`
      );
    }

    const inventoryClean =
      num(d.low_stock) === 0 &&
      num(d.reorder_items) === 0 &&
      num(d.expired_products) === 0 &&
      num(d.damaged_recent) === 0;

    const attention = inventoryClean
      ? "There are currently no low-stock or reorder items requiring immediate attention."
      : `Attention needed: ${bits.join(", and ")}.`;

    if (num(d.outstanding_orders) > 0) {
      return `${attention} You currently have ${money(
        d.outstanding
      )} outstanding across ${plural(
        d.outstanding_orders,
        "order",
        "orders"
      )}.`;
    }

    return attention;
  }

  /* =====================================================
     CONVERSATION CONTEXT
     Reuses the existing ai_conversations / ai_messages store.
     No new schema, no new persistence layer.
  ===================================================== */

  const REVENUE_FAMILY = [
    "todays_sales",
    "yesterday_sales",
    "this_week_sales",
    "last_week_sales",
    "this_month_revenue",
    "last_month_revenue",
    "total_revenue",
    "compare_months",
    "gross_profit",
    "daily_performance",
    "monthly_performance",
  ];

  const RANKED_FAMILY = [
    "top_products",
    "slow_products",
    "reorder",
    "low_stock",
    "sales_rep_performance",
    "top_retailers",
  ];

  async function loadContext(convId) {
    const empty = { prevIntent: null, prevData: null, hasHistory: false };
    if (!convId) return empty;

    try {
      const [rows] = await pool.query(
        `SELECT role, content, meta
         FROM ai_messages
         WHERE conversation_id = ?
         ORDER BY id DESC
         LIMIT 4`,
        [convId]
      );

      const assistantMsg = rows.find((r) => r.role === "assistant");
      if (!assistantMsg) return empty;

      let meta = assistantMsg.meta;
      if (typeof meta === "string") {
        try {
          meta = JSON.parse(meta);
        } catch {
          meta = null;
        }
      }

      return {
        prevIntent: meta?.intent || null,
        prevData: meta?.data ?? null,
        hasHistory: true,
      };
    } catch {
      return empty;
    }
  }

  const NUMBER_WORDS = {
    one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  };

  const ORDINALS = {
    first: 1, second: 2, third: 3, fourth: 4, fifth: 5,
    "1st": 1, "2nd": 2, "3rd": 3, "4th": 4, "5th": 5,
  };

  const OVERVIEW_INTENTS = [
    "business_summary",
    "business_alerts",
    "product_overview",
    "payment_overview",
    "order_overview",
    "inventory_health",
    "customer_overview",
    "business_recommendations",
    "daily_performance",
    "monthly_performance",
    "sales_trend",
  ];

  function extractLimit(msg) {
    const digits = msg.match(/\b(?:top|bottom)\s+(\d+)\b/);
    if (digits) return Math.min(10, Math.max(1, parseInt(digits[1], 10)));

    const words = msg.match(
      /\b(?:top|bottom)\s+(one|two|three|four|five|six|seven|eight|nine|ten)\b/
    );
    if (words) return NUMBER_WORDS[words[1]];

    const firstN = msg.match(
      /\b(first|top|bottom)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/
    );
    if (firstN) {
      const n = /^\d+$/.test(firstN[2])
        ? parseInt(firstN[2], 10)
        : NUMBER_WORDS[firstN[2]];
      if (n) return Math.min(10, Math.max(1, n));
    }

    return null;
  }

  function extractOrdinal(msg) {
    const m = msg.match(
      /\b(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th)\s*(one|item|product)?\b/
    );
    if (m) return ORDINALS[m[1]];
    return null;
  }

  /* "How many of those are pending?" style follow-ups. */
  function resolveStateFollowUp(msg) {
    if (!/\b(of those|of them|of these)\b/.test(msg)) return null;

    if (/\bpending\b/.test(msg)) return "pending_orders";
    if (/\b(outstanding|unpaid|owed?|overdue)\b/.test(msg)) return "overdue";
    if (/\b(cancel+ed|cancelled)\b/.test(msg)) return "cancelled_orders";
    if (/\b(expired|expiry)\b/.test(msg)) return "expired";
    if (/\b(damaged|damage)\b/.test(msg)) return "damaged";
    if (/\b(reorder|reordering|restock|restocking|buy again)\b/.test(msg)) {
      return "reorder";
    }
    if (/\blow\b/.test(msg)) return "low_stock";

    return null;
  }

  function detectFollowUp(msg, ctx) {
    if (!ctx || !ctx.prevIntent) return null;

    const prev = ctx.prevIntent;
    const prevIsRevenue = REVENUE_FAMILY.includes(prev);
    const prevIsRanked = RANKED_FAMILY.includes(prev);
    const prevIsOverview = OVERVIEW_INTENTS.includes(prev);
    const carriesOver = /what about|how about|how did|and |compared|that one/.test(
      msg
      );
    const prevData = ctx.prevData && typeof ctx.prevData === "object" ? ctx.prevData : {};

    /* Sales ambiguity resolved by prior context (§3). */
    if (
      prevIsRevenue &&
      /sales (overview|insights?|report|summary)|how (are|is) (our |the )?sales|sales (are |is )?(doing|looking)/.test(
        msg
      )
    ) {
      return { intent: prev, viaContext: true };
    }

    /* "How many of those are pending?" (§7) */
    if (prevIsOverview || prevIsRanked) {
      const stateIntent = resolveStateFollowUp(msg);
      if (stateIntent) return { intent: stateIntent, viaContext: true };
    }

    /* "Show me those." / "List them." → replay the most recent real report (§7) */
    if (
      prev !== "fallback" &&
      prev !== "clarification" &&
      (/^(show|list|see)\b.*\b(those|them|these)\b/.test(msg) ||
        /^(those|them|these)\??$/.test(msg))
    ) {
      return { intent: prev, viaContext: true };
    }

    /* "Which products are affected?" (§7) */
    if (
      /\b(which|what) products are affected\b/.test(msg) &&
      prev !== "fallback" &&
      prev !== "clarification"
    ) {
      /* Prefer whichever concern actually has rows; otherwise stay
         deterministic rather than dropping to a generic fallback. */
      if (num(prevData.low_stock) > 0) {
        return { intent: "low_stock", viaContext: true };
      }
      if (num(prevData.reorder_items) > 0) {
        return { intent: "reorder", viaContext: true };
      }
      return { intent: "low_stock", viaContext: true };
    }

    /* Ranking follow-ups (§8) */
    const limit = extractLimit(msg);
    if (limit && prevIsRanked) {
      return { intent: prev, limit, viaContext: true };
    }

    if (prevIsRanked) {
      const ordinal = extractOrdinal(msg);
      if (ordinal && /^(show|list|which|what)\b/.test(msg)) {
        return {
          intent: prev,
          limit: 1,
          offset: ordinal - 1,
          viaContext: true,
        };
      }
    }

    if (
      /which one is the best|which is the best|which one'?s best|best one|top one|which is best/.test(
        msg
      ) &&
      (prev === "top_products" || prev === "slow_products")
    ) {
      return { intent: "top_products", limit: 1, viaContext: true };
    }

    if (
      /which one is the worst|which is the worst|which one'?s worst|worst one|weakest|which is worst/.test(
        msg
      ) &&
      (prev === "top_products" || prev === "slow_products")
    ) {
      return { intent: "slow_products", limit: 1, viaContext: true };
    }

    /* Change follow-ups */
    if (
      /how much did it change|what'?s the change|how did it change|did it increase|did it decrease|increase or decrease|is it better than last month/.test(
        msg
      ) &&
      (prevIsRevenue || prevIsOverview)
    ) {
      return { intent: "compare_months", viaContext: true };
    }

    /* Temporal shifts */
    if (prevIsRevenue && /yesterday/.test(msg) && carriesOver) {
      return { intent: "yesterday_sales", viaContext: true };
    }
    if (prevIsRevenue && /last month|previous month/.test(msg)) {
      return { intent: "last_month_revenue", viaContext: true };
    }
    if (prevIsRevenue && /\blast week\b|\bprevious week\b/.test(msg)) {
      return { intent: "last_week_sales", viaContext: true };
    }
    if (prevIsRevenue && /\bthis week\b/.test(msg)) {
      return { intent: "this_week_sales", viaContext: true };
    }
    if (prevIsRevenue && /this month/.test(msg)) {
      return { intent: "this_month_revenue", viaContext: true };
    }
    if (prevIsRevenue && /\btoday\b/.test(msg) && carriesOver) {
      return { intent: "todays_sales", viaContext: true };
    }

    return null;
  }

  const TOPIC_LABELS = {
    todays_sales: "today's sales",
    yesterday_sales: "yesterday's sales",
    this_week_sales: "this week's sales",
    last_week_sales: "last week's sales",
    this_month_revenue: "this month's revenue",
    last_month_revenue: "last month's revenue",
    total_revenue: "total revenue",
    compare_months: "the monthly comparison",
    gross_profit: "gross profit",
    top_products: "your top-selling products",
    slow_products: "your slow-moving products",
    low_stock: "low-stock items",
    reorder: "products needing reordering",
    inventory_value: "inventory value",
    pending_orders: "pending orders",
    cancelled_orders: "cancelled orders",
    todays_orders: "today's orders",
    total_orders: "total orders",
    total_customers: "your customer base",
    todays_customers: "today's customers",
    top_retailers: "your top customers",
    overdue: "outstanding payments",
    sales_rep_performance: "sales-rep performance",
    expired: "expired products",
    damaged: "damaged inventory",
    business_summary: "the business summary",
    business_alerts: "the business alerts",
    product_overview: "the product overview",
    payment_overview: "the payment overview",
    order_overview: "the order overview",
    inventory_health: "your inventory health",
    customer_overview: "the customer overview",
    business_recommendations: "the recommendations",
    daily_performance: "today's performance",
    monthly_performance: "this month's performance",
    sales_trend: "the sales trend",
  };

  function needsClarification(msg) {
    if (
      /^(how (are|is) (sales|things|business|it|that|everything)|how'?s (sales|it going|it look)|show (me )?(performance|sales)( report)?|performance report|what can you (do|tell)|what about (it|that|them))/.test(
        msg
      )
    ) {
      return true;
    }

    if (/^(and|it|that|them|those|so|more|details?|explain|and\?+|and\.+)$/.test(msg)) {
      return true;
    }

    /* Bare topic nouns: too ambiguous to guess a report, so ask (§11). */
    if (/^(stock|inventory|items?|products?|orders?|payments?|money)$/.test(msg)) {
      return true;
    }

    return false;
  }

  function buildClarification(ctx, reason) {
    if (reason === "date") {
      return "I can currently report on today, yesterday, this week, last week, this month, and last month — the existing reports don't cover arbitrary dates. Would you like today's figures, yesterday's, this week's, or a comparison with last month?";
    }

    if (reason === "sales") {
      return "Sure. Would you like today's sales, this week's sales, this month's sales, total sales, or a comparison with last month?";
    }

    if (ctx && ctx.prevIntent && TOPIC_LABELS[ctx.prevIntent]) {
      return `Sure — just before you asked about ${TOPIC_LABELS[ctx.prevIntent]}. Would you like me to go deeper into that, or switch to something else such as today's sales, revenue, products, or payments?`;
    }

    return "Sure — could you clarify what you'd like to see? I can help with today's sales, yesterday's sales, this month's revenue, total revenue, profit, customers, products, stock levels, reordering, or outstanding payments.";
  }

  /* =====================================================
     BUSINESS NARRATION
     Turns deterministic query results into professional,
     natural answers. Never invents values: every number below
     comes straight from the data returned by the executor.
  ===================================================== */

  /* Every revenue figure is read from the booked order value on
     orders.total_amount. It is not a settled/paid amount, so any answer that
     quotes revenue says where the number came from. */
  const REVENUE_SOURCE = "orders.total_amount";

  const REVENUE_INTENTS = new Set([
    "business_summary",
    "daily_performance",
    "monthly_performance",
    "sales_trend",
    "todays_sales",
    "yesterday_sales",
    "this_week_sales",
    "last_week_sales",
    "total_revenue",
    "this_month_revenue",
    "last_month_revenue",
    "compare_months",
    "gross_profit",
    "sales_rep_performance",
  ]);

  const reportsRevenue = (intent) => REVENUE_INTENTS.has(intent);

  const revenueSourceNote = () =>
    `\n\nSource: ${REVENUE_SOURCE} (booked order value, not settled payments).`;

  function narrateBase(intent, data, opts = {}) {
    const limit = opts.limit || null;
    const offset = opts.offset || 0;
    const d = data || {};

    /* Ranking helper: honours a requested slice (top N / "the second one"). */
    const slice = (rows) => {
      const start = offset;
      const end = limit ? start + limit : undefined;
      return (Array.isArray(rows) ? rows : []).slice(start, end);
    };

    switch (intent) {
      case "business_summary": {
        const lines = [
          `Sales: ${plural(d.today_orders, "order", "orders")}`,
          `Revenue: ${money(d.today_revenue)}`,
          `Customers served: ${num(d.today_customers)}`,
          `Pending orders: ${num(d.pending_orders)}`,
          `Outstanding payments: ${money(d.outstanding)}`,
          `Low-stock products: ${num(d.low_stock)}`,
          `Products requiring reorder: ${num(d.reorder_items)}`,
          `Expired products: ${num(d.expired_products)}`,
          `Damaged inventory: ${num(d.damaged_recent)}`,
        ];

        return `Here's your current business overview:\n\n${bulletList(
          lines
        )}\n\n${attentionLine(d)}`;
      }

      /* ---------- Phase 5: business intelligence ---------- */

      case "inventory_health": {
        const lines = [
          `Total active products: ${num(d.total_products)}`,
          `Low-stock products: ${num(d.low_stock)}`,
          `Products requiring reorder: ${num(d.reorder_items)}`,
          `Expired products: ${num(d.expired_products)}`,
          `Damaged inventory records (last 30 days): ${num(d.damaged_recent)}`,
        ];

        /* Value is only reported when the products actually carry a cost
           price — otherwise it would understate stock silently. */
        if (num(d.priced_products) > 0) {
          lines.push(`Inventory value at cost: ${money(d.inventory_cost_value)}`);
          lines.push(
            `Inventory value at selling price: ${money(d.inventory_retail_value)}`
          );
        }

        const footer = attentionLine({
          low_stock: d.low_stock,
          reorder_items: d.reorder_items,
          expired_products: d.expired_products,
          damaged_recent: d.damaged_recent,
          outstanding_orders: 0,
          outstanding: 0,
        });

        const valueNote =
          num(d.priced_products) > 0
            ? ""
            : "\n\nInventory value is not shown because these products have no purchase price recorded.";

        return `Here's your current inventory health:\n\n${bulletList(
          lines
        )}${valueNote}\n\n${footer}`;
      }

      case "daily_performance": {
        const hasToday = num(d.today_orders) > 0 || num(d.today_revenue) > 0;
        const hasYesterday =
          num(d.yesterday_orders) > 0 || num(d.yesterday_revenue) > 0;

        const lines = [
          `Orders today: ${num(d.today_orders)}`,
          `Revenue today: ${money(d.today_revenue)}`,
          `Customers today: ${num(d.today_customers)}`,
        ];

        const headline = hasToday
          ? `Today's performance so far: ${plural(
              d.today_orders,
              "order",
              "orders"
            )} worth ${money(d.today_revenue)} from ${plural(
              d.today_customers,
              "customer",
              "customers"
            )}.`
          : "No orders have been recorded today so far.";

        let compare;
        if (!hasYesterday) {
          compare =
            "There are no orders recorded for yesterday, so there is no previous day to compare against.";
        } else {
          const revenueDelta = changePct(d.today_revenue, d.yesterday_revenue);
          const orderDelta = changePct(d.today_orders, d.yesterday_orders);

          const revenuePart =
            revenueDelta === null
              ? `today's revenue of ${money(
                  d.today_revenue
                )} against no recorded revenue yesterday`
              : `revenue ${directionWord(
                  revenueDelta
                )} ${pct(Math.abs(revenueDelta))} versus yesterday`;

          const orderPart =
            orderDelta === null
              ? ""
              : ` Orders are ${directionWord(
                  orderDelta
                )} ${pct(Math.abs(orderDelta))}.`;

          compare = `Yesterday recorded ${plural(
            d.yesterday_orders,
            "order",
            "orders"
          )} worth ${money(
            d.yesterday_revenue
          )}. Compared with that, ${revenuePart}.${orderPart}`;
        }

        return `${headline}\n\n${bulletList(lines)}\n\n${compare}`;
      }

      case "monthly_performance": {
        const hasThisMonth =
          num(d.this_month_orders) > 0 || num(d.this_month_revenue) > 0;
        const hasLastMonth =
          num(d.last_month_orders) > 0 || num(d.last_month_revenue) > 0;

        const lines = [
          `Orders this month: ${num(d.this_month_orders)}`,
          `Revenue this month: ${money(d.this_month_revenue)}`,
          `Customers this month: ${num(d.this_month_customers)}`,
        ];

        const headline = hasThisMonth
          ? `This month so far: ${plural(
              d.this_month_orders,
              "order",
              "orders"
            )} worth ${money(d.this_month_revenue)}.`
          : "No orders have been recorded this month so far.";

        let compare;
        if (!hasLastMonth) {
          compare =
            "There are no orders recorded for last month, so there is nothing to compare against yet.";
        } else {
          const revenueDelta = changePct(
            d.this_month_revenue,
            d.last_month_revenue
          );
          const orderDelta = changePct(
            d.this_month_orders,
            d.last_month_orders
          );

          const revenuePart =
            revenueDelta === null
              ? `this month's revenue of ${money(
                  d.this_month_revenue
                )} against no recorded revenue last month`
              : `revenue ${directionWord(
                  revenueDelta
                )} ${pct(Math.abs(revenueDelta))} versus last month`;

          const orderPart =
            orderDelta === null
              ? ""
              : ` Orders are ${directionWord(
                  orderDelta
                )} ${pct(Math.abs(orderDelta))}.`;

          compare = `Last month recorded ${plural(
            d.last_month_orders,
            "order",
            "orders"
          )} worth ${money(
            d.last_month_revenue
          )}. Compared with that, ${revenuePart}.${orderPart}`;
        }

        return `${headline}\n\n${bulletList(
          lines
        )}\n\n${compare}\n\nNote: this compares the current month to date against the whole of last month.`;
      }

      case "sales_trend": {
        const rows = Array.isArray(d.days) ? d.days : [];
        const recorded = num(d.recorded_days);

        /* Rule: never pad missing dates with zeros and never present a
           single day as a "trend". */
        if (!d.sufficient || rows.length === 0) {
          return `I don't have enough historical sales data to calculate a meaningful trend yet. Sales are recorded on ${plural(
            recorded,
            "day",
            "days"
          )} in the last ${num(
            d.window_days
          )} days, and a meaningful trend needs at least 3 recorded days. Days without orders are not counted as zero.`;
        }

        const revenueDelta = changePct(d.latest_revenue, d.first_revenue);

        const trendLine =
          revenueDelta === null
            ? `The most recent recorded day (${shortDate(
                d.latest_day
              )}) has no earlier recorded day in this window to compare against.`
            : `Revenue on the most recent recorded day (${shortDate(
                d.latest_day
              )}, ${money(d.latest_revenue)}) is ${directionWord(
                revenueDelta
              )} ${pct(Math.abs(revenueDelta))} compared with the earliest recorded day in the window (${shortDate(
                d.first_day
              )}, ${money(d.first_revenue)}).`;

        const days = rows
          .map((r) => `• ${shortDate(r.day)} — ${plural(r.orders, "order", "orders")}, ${money(r.revenue)}`)
          .join("\n");

        return `Sales trend across ${plural(
          recorded,
          "recorded day",
          "recorded days"
        )} in the last ${num(d.window_days)} days:\n\n${bulletList(
          [
            `Total revenue: ${money(d.total_revenue)}`,
            `Total orders: ${num(d.total_orders)}`,
            `Best recorded day: ${shortDate(d.best_day)} (${money(d.best_revenue)})`,
          ]
        )}\n\n${trendLine}\n\nRecorded days, most recent first:\n${days}\n\nDays without orders are not included and are not treated as zero.`;
      }

      case "customer_overview": {
        const lines = [
          `Total customers: ${num(d.total_customers)}`,
          `Customers who have placed orders: ${num(d.customers_with_orders)}`,
          `Customers ordering this month: ${num(d.this_month_customers)}`,
          `New customers this month: ${num(d.new_customers_this_month)}`,
          `Revenue from all recorded orders: ${money(d.lifetime_revenue)}`,
        ];

        let tail;
        if (num(d.total_customers) === 0) {
          tail = "There are no customer accounts in the DMS yet.";
        } else if (num(d.customers_with_orders) === 0) {
          tail =
            "No customer-linked orders have been recorded yet, so no per-customer figures can be shown.";
        } else if (d.top_customer_name !== undefined) {
          tail = `Highest-spending customer: ${displayName(
            d.top_customer_name, "Unnamed customer"
          )} — ${plural(
            d.top_customer_orders,
            "order",
            "orders"
          )} worth ${money(d.top_customer_spend)}.`;
        } else {
          tail =
            "No per-customer spending could be determined from the current records.";
        }

        return `Here's your customer overview:\n\n${bulletList(
          lines
        )}\n\n${tail}`;
      }

      case "business_recommendations": {
        const items = [];

        if (num(d.pending_orders) > 0) {
          items.push(
            `Review ${plural(
              d.pending_orders,
              "pending order",
              "pending orders"
            )} that have not been processed yet.`
          );
        }
        if (num(d.outstanding_orders) > 0) {
          items.push(
            `Follow up on ${money(
              d.outstanding
            )} outstanding across ${plural(
              d.outstanding_orders,
              "order",
              "orders"
            )}.`
          );
        }
        if (num(d.in_progress_orders) > 0) {
          items.push(
            `Track ${plural(
              d.in_progress_orders,
              "order",
              "orders"
            )} confirmed or shipped but not yet delivered.`
          );
        }
        if (num(d.reorder_items) > 0) {
          items.push(
            `Raise reorders for ${plural(
              d.reorder_items,
              "product",
              "products"
            )} at or below the reorder level.`
          );
        }
        if (num(d.low_stock) > 0) {
          items.push(
            `Check ${plural(
              d.low_stock,
              "product",
              "products"
            )} below the configured low-stock threshold.`
          );
        }
        if (num(d.expired_products) > 0) {
          items.push(
            `Remove or discount ${plural(
              d.expired_products,
              "expired product",
              "expired products"
            )} from saleable stock.`
          );
        }
        if (num(d.damaged_recent) > 0) {
          items.push(
            `Review ${plural(
              d.damaged_recent,
              "damaged inventory record",
              "damaged inventory records"
            )} logged in the last 30 days.`
          );
        }

        if (items.length > 0) {
          return `Based on the current DMS data:\n\n${numbered(
            items.map((text) => ({ text })),
            10,
            (r) => r.text
          )}\n\nThese are suggestions based on conditions detected in your records — I have not made any changes.`;
        }

        return `Based on the current DMS data, no condition needs immediate attention right now:\n\n${bulletList(
          [
            `Pending orders: ${num(d.pending_orders)}`,
            `Outstanding payments: ${money(d.outstanding)}`,
            `Confirmed or shipped orders awaiting delivery: ${num(
              d.in_progress_orders
            )}`,
            `Low-stock products: ${num(d.low_stock)}`,
            `Products requiring reorder: ${num(d.reorder_items)}`,
            `Expired products: ${num(d.expired_products)}`,
            `Damaged inventory records (last 30 days): ${num(d.damaged_recent)}`,
          ]
        )}\n\nThese are suggestions based on conditions detected in your records — I have not made any changes.`;
      }

      case "business_alerts": {
        const issues = [];

        if (num(d.pending_orders) > 0) {
          issues.push(
            `${plural(
              d.pending_orders,
              "order is",
              "orders are"
            )} pending.`
          );
        }
        if (num(d.outstanding_orders) > 0) {
          issues.push(
            `${plural(
              d.outstanding_orders,
              "order has",
              "orders have"
            )} outstanding payments totalling ${money(d.outstanding)}.`
          );
        }
        if (num(d.low_stock) > 0) {
          issues.push(
            `${plural(
              d.low_stock,
              "product is",
              "products are"
            )} below the configured low-stock threshold.`
          );
        }
        if (num(d.reorder_items) > 0) {
          issues.push(
            `${plural(
              d.reorder_items,
              "product is",
              "products are"
            )} at or below its reorder level.`
          );
        }
        if (num(d.expired_products) > 0) {
          issues.push(
            `${plural(
              d.expired_products,
              "product has",
              "products have"
            )} passed its expiry date.`
          );
        }
        if (num(d.damaged_recent) > 0) {
          issues.push(
            `${plural(
              d.damaged_recent,
              "damaged inventory record has",
              "damaged inventory records have"
            )} been logged in the last 30 days.`
          );
        }

        if (issues.length === 0) {
          return "I didn't find any inventory or payment issues requiring immediate attention.";
        }

        return `Here are the items that currently need attention:\n\n${bulletList(
          issues
        )}\n\nI can show you the details of any of these.`;
      }

      case "product_overview": {
        const lines = [];

        if (d.top_product) {
          lines.push(`Top-selling product: ${d.top_product}`);
        }
        if (d.slow_product && d.slow_product !== d.top_product) {
          lines.push(`Slowest-moving product: ${d.slow_product}`);
        }
        lines.push(`Low-stock products: ${num(d.low_stock)}`);
        lines.push(`Products requiring reorder: ${num(d.reorder_items)}`);
        lines.push(`Expired products: ${num(d.expired_products)}`);
        lines.push(`Damaged inventory records: ${num(d.damaged_recent)}`);

        let closing;
        if (!d.top_product) {
          closing =
            "There is no recorded sales history yet, so product performance can't be ranked.";
        } else if (num(d.low_stock) === 0 && num(d.reorder_items) === 0) {
          closing =
            "All products are currently above their configured stock thresholds.";
        } else {
          closing = `${attentionLine(d)}`;
        }

        return `Here's your current product overview:\n\n${bulletList(
          lines
        )}\n\n${closing}`;
      }

      case "payment_overview": {
        if (num(d.count) === 0) {
          return "There are currently no outstanding payments.";
        }
        return `There are currently ${plural(
          d.count,
          "order",
          "orders"
        )} with outstanding payments totalling ${money(d.outstanding)}.`;
      }

      case "order_overview": {
        return `Here's the current order status:\n\n${bulletList([
          `Total orders: ${num(d.total_orders)}`,
          `Today's orders: ${num(d.today_orders)}`,
          `Pending orders: ${num(d.pending_orders)}`,
          `Cancelled orders: ${num(d.cancelled_orders)}`,
          `Orders with outstanding payments: ${num(d.outstanding_orders)}`,
        ])}`;
      }

      case "todays_sales": {
        if (num(d.orders) === 0) {
          return "There are no recorded sales for today — no orders have been logged yet.";
        }
        return `Today you have ${plural(
          d.orders,
          "order",
          "orders"
        )} worth ${money(d.revenue)} in recorded revenue.`;
      }

      case "yesterday_sales": {
        if (num(d.orders) === 0) {
          return "There were no recorded sales yesterday.";
        }
        return `Yesterday you had ${plural(
          d.orders,
          "order",
          "orders"
        )} worth ${money(d.revenue)} in recorded revenue.`;
      }

      case "this_week_sales": {
        if (num(d.orders) === 0) {
          return "There are no recorded sales so far this week.";
        }
        return `So far this week you have ${plural(
          d.orders,
          "order",
          "orders"
        )} worth ${money(d.revenue)} in recorded revenue.`;
      }

      case "last_week_sales": {
        if (num(d.orders) === 0) {
          return "There were no recorded sales last week.";
        }
        return `Last week you had ${plural(
          d.orders,
          "order",
          "orders"
        )} worth ${money(d.revenue)} in recorded revenue.`;
      }

      case "todays_customers": {
        if (num(d.customers) === 0) {
          return "No customers have placed orders today.";
        }
        return `${plural(
          d.customers,
          "customer has",
          "customers have"
        )} placed orders today.`;
      }

      case "total_customers": {
        if (num(d.customers) === 0) {
          return "There are no customer records in the system yet.";
        }
        return `We currently have ${plural(
          d.customers,
          "customer",
          "customers"
        )} in the system.`;
      }

      case "total_revenue": {
        if (num(d.orders) === 0) {
          return "There are no non-cancelled orders in the system yet, so there is no recorded revenue.";
        }
        return `Your total recorded revenue is ${money(
          d.revenue
        )} across ${plural(d.orders, "order", "orders")}.`;
      }

      case "this_month_revenue": {
        if (num(d.orders) === 0) {
          return "There have been no sales recorded so far this month.";
        }
        return `So far this month you have ${plural(
          d.orders,
          "order",
          "orders"
        )} worth ${money(d.revenue)} in recorded revenue.`;
      }

      case "last_month_revenue": {
        if (num(d.orders) === 0) {
          return "There were no sales recorded last month.";
        }
        return `Last month you had ${plural(
          d.orders,
          "order",
          "orders"
        )} worth ${money(d.revenue)} in recorded revenue.`;
      }

      case "compare_months": {
        const thisRev = num(d.thisMonth?.revenue);
        const lastRev = num(d.lastMonth?.revenue);
        const thisOrders = num(d.thisMonth?.orders);
        const lastOrders = num(d.lastMonth?.orders);

        if (thisRev === 0 && lastRev === 0) {
          return "There is no revenue recorded for either this month or last month, so I can't calculate a change.";
        }
        if (lastRev === 0) {
          return `Revenue this month is ${money(
            thisRev
          )} across ${plural(
            thisOrders,
            "order",
            "orders"
          )}, and there was no recorded revenue last month, so a percentage change can't be calculated.`;
        }

        const change = ((thisRev - lastRev) / lastRev) * 100;
        const direction = change >= 0 ? "an increase" : "a decrease";

        return `Revenue this month is ${money(
          thisRev
        )} compared with ${money(lastRev)} last month — ${direction} of approximately ${Math.abs(
          change
        ).toFixed(1)}%. Order volume went from ${plural(
          lastOrders,
          "order",
          "orders"
        )} to ${plural(thisOrders, "order", "orders")}.`;
      }

      case "low_stock": {
        if (num(d.count) === 0) {
          return "All products are currently above their configured low-stock threshold.";
        }
        return `${plural(
          d.count,
          "product is",
          "products are"
        )} at or below the configured low-stock threshold and need attention.`;
      }

      case "top_products": {
        const all = Array.isArray(data) ? data : [];
        const shown = slice(all);
        if (all.length === 0) {
          return "There is no recorded sales history yet, so I can't identify any best sellers.";
        }
        if (shown.length === 0) {
          return "There isn't a product at that position in the current ranking.";
        }
        const heading =
          shown.length === 1 && offset > 0
            ? `At position ${offset + 1}, the product is:`
            : shown.length === 1
            ? "Based on recorded sales, your best-selling product is:"
            : `Here are your top ${shown.length} selling products:`;
        return `${heading}\n${numbered(
          shown,
          shown.length,
          (r) => `${r.name} — ${plural(r.qty, "unit", "units")} — ${money(r.revenue)} revenue`
        )}`;
      }

      case "slow_products": {
        const all = Array.isArray(data) ? data : [];
        const shown = slice(all);
        if (all.length === 0) {
          return "Every product in your catalogue has sold at least once, so there are no slow-moving items right now.";
        }
        if (shown.length === 0) {
          return "There isn't a product at that position in the current ranking.";
        }
        const heading =
          shown.length === 1 && offset > 0
            ? `At position ${offset + 1}, the product is:`
            : shown.length === 1
            ? "This is your slowest-moving product:"
            : `These are your ${shown.length} slowest-moving products:`;
        return `${heading}\n${numbered(
          shown,
          shown.length,
          (r) => `${r.name} — ${plural(r.qty, "unit", "units")} — ${money(r.revenue)} revenue`
        )}`;
      }

      case "inventory_value": {
        return `The total value of your active inventory, valued at purchase cost, is ${money(
          d.value
        )}.`;
      }

      case "pending_orders": {
        if (num(d.count) === 0) {
          return "There are currently no pending orders.";
        }
        return `There ${num(d.count) === 1 ? "is" : "are"} ${plural(
          d.count,
          "pending order",
          "pending orders"
        )} waiting to be processed.`;
      }

      case "cancelled_orders": {
        if (num(d.count) === 0) {
          return "No orders have been cancelled.";
        }
        return `${plural(
          d.count,
          "order has",
          "orders have"
        )} been cancelled.`;
      }

      case "todays_orders": {
        if (num(d.count) === 0) {
          return "No orders have been placed today.";
        }
        return `${plural(
          d.count,
          "order was",
          "orders were"
        )} placed today.`;
      }

      case "total_orders": {
        if (num(d.count) === 0) {
          return "There are no orders in the system yet.";
        }
        return `There are ${plural(d.count, "order", "orders")} in the system in total.`;
      }

      case "top_retailers": {
        const rows = Array.isArray(data) ? data : [];
        if (rows.length === 0) {
          return "There is no recorded purchase activity from customers yet.";
        }
        const shown = rows.slice(0, limit || 5);
        return `Your highest-value customers by recorded revenue are:\n${numbered(
          shown,
          shown.length,
          (r) => `${displayName(r.name, "Unnamed customer")} — ${money(r.total)}`
        )}`;
      }

      case "gross_profit": {
        if (num(d.revenue) === 0) {
          return "There are no delivered orders yet, so I can't calculate gross profit.";
        }
        return `Your gross profit is ${money(
          d.profit
        )} from ${money(d.revenue)} in revenue and ${money(
          d.cost
        )} in recorded cost, giving a gross margin of ${pct(d.margin)}.`;
      }

      case "overdue": {
        if (num(d.count) === 0) {
          return "All non-cancelled orders are fully settled — there are no outstanding payments.";
        }
        return `${plural(
          d.count,
          "order has",
          "orders have"
        )} an outstanding balance, totalling ${money(d.outstanding)}.`;
      }

      case "sales_rep_performance": {
        const rows = Array.isArray(data) ? data : [];
        if (rows.length === 0) {
          return "There is currently no sales-representative performance data available.";
        }
        const shown = rows.slice(0, limit || 5);
        return `Sales-representative performance based on recorded orders:\n${numbered(
          shown,
          shown.length,
          (r) => `${displayName(r.name, "Unnamed sales representative")} — ${plural(r.orders, "order", "orders")} — ${money(r.revenue)} revenue`
        )}`;
      }

      case "reorder": {
        const rows = Array.isArray(data) ? data : [];
        if (rows.length === 0) {
          return "I checked the current inventory, and there are no products that require reordering right now.";
        }
        const shown = rows.slice(0, limit || 10);
        return `I checked the current inventory and found ${plural(
          shown.length,
          "product",
          "products"
        )} at or below its reorder level:\n${numbered(
          shown,
          shown.length,
          (r) => `${r.name} — ${plural(r.stock, "unit in stock", "units in stock")} — reorder at ${r.effective_reorder_level}`
        )}`;
      }

      case "expired": {
        const expiredCount = num(d.expired_products);
        const recentCount = num(d.recent_expiry_records);

        if (expiredCount === 0 && recentCount === 0) {
          return "There are currently no expired products recorded.";
        }

        const parts = [];
        if (expiredCount > 0) {
          parts.push(
            `${plural(
              expiredCount,
              "product has",
              "products have"
            )} passed its expiry date.`
          );
        }
        if (recentCount > 0) {
          parts.push(
            `There ${recentCount === 1 ? "is" : "are"} ${plural(
              recentCount,
              "expiry record",
              "expiry records"
            )} logged in the last 30 days.`
          );
        }

        return parts.join(" ");
      }

      case "damaged": {
        if (num(d.count) === 0) {
          return "There are currently no damaged inventory records.";
        }
        return `${plural(
          d.count,
          "damaged inventory record has",
          "damaged inventory records have"
        )} been logged in the last 30 days.`;
      }

      default:
        return FALLBACK_ANSWER;
    }
  }

  /* Single entry point for every user-visible sentence. Wrapping narrateBase
     here means the source disclosure cannot be forgotten by a new intent. */
  function narrate(intent, data, opts = {}) {
    const text = narrateBase(intent, data, opts);
    return reportsRevenue(intent) ? `${text}${revenueSourceNote()}` : text;
  }

/* =====================================================
     TOOL EXECUTION
     Every intent is served by a registered tool in
     backend/services/ai. The registry authorises the caller's role,
     validates arguments and refuses anything but read-only SQL.
     Unknown intents resolve to no tool, which keeps the previous
     "no data" fallback behaviour.
  ===================================================== */

  async function runAdminTool(intent, req) {
    const toolName = aiRegistry.toolNameForIntent(intent);

    if (!toolName) {
      return { data: null };
    }

    const executed = await aiRegistry.execute({
      toolName,
      intent,
      actor: { userId: req.user.id, role: req.user.role },
      db: pool,
      args: {},
    });

    return { data: executed.data };
  }

  /* =====================================================
     POST /query — AI NLP query endpoint
  ===================================================== */

  router.post("/query", aiLimiter, async (req, res) => {
    try {
      const { message, conversationId } = req.body || {};

      /* typeof guard first: a number/array/object body would make .trim()
         throw and surface as a 500 instead of a client error. */
      if (typeof message !== "string" || !message.trim()) {
        return res.status(400).json({ error: "Message is required" });
      }

      if (message.trim().length > AI_MAX_MESSAGE_LENGTH) {
        return res.status(413).json({
          error: `Message is too long. Please keep it under ${AI_MAX_MESSAGE_LENGTH} characters.`,
        });
      }

      /* Resolve the conversation FIRST so its history can be used as context. */
      let convId = conversationId || null;

      if (convId) {
        const [[existing]] = await pool.query(
          "SELECT id FROM ai_conversations WHERE id=? AND user_id=?",
          [convId, req.user.id]
        );

        if (!existing) {
          convId = null;
        }
      }

      if (!convId) {
        const title =
          message.length > 80 ? message.substring(0, 80) + "..." : message;

        const [convResult] = await pool.query(
          "INSERT INTO ai_conversations (user_id, title) VALUES (?, ?)",
          [req.user.id, title]
        );

        convId = convResult.insertId;
      }

      const context = await loadContext(convId);
      const cleanMsg = message.trim().toLowerCase();

      let detected = detectIntent(message);
      let intent = detected ? detected.intent : "fallback";
      /* Honour an explicit "top 3" / "bottom 3" on the first message too,
         not only on context follow-ups. */
      let opts = { limit: extractLimit(cleanMsg), offset: 0 };
      let clarification = null;

      const applyFollowUp = (followUp) => {
        detected = { intent: followUp.intent, answer: followUp.intent };
        intent = followUp.intent;
        opts = {
          limit: followUp.limit || null,
          offset: followUp.offset || 0,
          viaContext: true,
        };
      };

      /* detectIntent can flag an ambiguous request (unsupported date, bare
         "sales"). Try conversation context before asking for clarification. */
      if (detected && detected.intent === "clarification") {
        const resolved = detectFollowUp(cleanMsg, context);

        if (resolved) {
          applyFollowUp(resolved);
        } else {
          clarification = buildClarification(context, detected.clarify);
          intent = "clarification";
          detected = null;
        }
      }

      if (!detected && !clarification) {
        const followUp = detectFollowUp(cleanMsg, context);

        if (followUp) {
          applyFollowUp(followUp);
        } else if (needsClarification(cleanMsg)) {
          clarification = buildClarification(context);
          intent = "clarification";
        }
      }

      /* Routing metadata only. The raw user message may contain customer names,
         order details or other business data, so it is deliberately never
         logged; length and a stable fingerprint are enough to correlate a
         report with its request. */
      console.log("[AI]", {
        conversationId: convId,
        intent,
        contextIntent: context.prevIntent,
        viaContext: Boolean(opts.viaContext),
        messageLength: message.length,
      });

      let result;
      /* Kept outside the branch so the LLM call below can reuse this exact
         payload as precomputed data (M2 — single tool execution per request). */
      let executedData = null;

      if (clarification) {
        result = {
          answer: clarification,
          data: { needsClarification: true },
        };
      } else {
        /* The tool returns only the data payload; every user-visible sentence
           comes from narrate() so there is a single phrasing source. */
        const executed = detected
          ? await runAdminTool(detected.intent, req)
          : {
              data: null,
            };
        executedData = executed.data;

        result = {
          answer: detected
            ? narrate(detected.intent, executed.data, opts)
            : FALLBACK_ANSWER,
          data: executed.data,
        };
      }

      /* Phase 3: the LLM may narrate this answer, within a strict time budget.
         It runs only for a tool-backed intent, only through the Phase 1
         registry, and only for the tool detectIntent() already selected, so the
         answer and the returned data always describe the same thing.

         answerWithLlm() never throws and never returns text unless it succeeded,
         so every failure - disabled, misconfigured, timed out, refused or
         malformed - leaves result.answer exactly as the deterministic layer
         computed it. Persisting and responding therefore stay consistent. */
      if (detected) {
        const llm = await answerWithLlm({
          actor: { userId: req.user.id, role: req.user.role },
          message,
          db: pool,
          surface: "admin",
          conversationId: convId,
          deterministicIntent: detected.intent,
          /* Sealed server-side from the authorized tool call above. The
             orchestrator narrates from this data and never re-runs the tool. */
          precomputedResult: sealPrecomputedToolResult(
            aiRegistry.toolNameForIntent(detected.intent),
            executedData
          ),
        });

        if (llm.ok && llm.text) {
          result.answer = llm.text;
        }
      }

      await pool.query(
        "INSERT INTO ai_messages (conversation_id, role, content) VALUES (?, 'user', ?)",
        [convId, message]
      );

      await pool.query(
        "INSERT INTO ai_messages (conversation_id, role, content, meta) VALUES (?, 'assistant', ?, ?)",
        [
          convId,
          result.answer,
          JSON.stringify({
            intent,
            data: result.data,
            /* Kept in meta so the disclosure survives a conversation reload. */
            ...(reportsRevenue(intent) ? { source: REVENUE_SOURCE } : {}),
          }),
        ]
      );

      await pool.query(
        "UPDATE ai_conversations SET updated_at = NOW() WHERE id = ?",
        [convId]
      );

      res.json({
        success: true,
        data: {
          answer: result.answer,
          data: result.data,
          intent,
          conversationId: convId,
          ...(reportsRevenue(intent) ? { source: REVENUE_SOURCE } : {}),
        },
      });
    } catch (err) {
      console.error("AI QUERY ERROR:", err);
      res.status(500).json({ error: "Failed to process AI query" });
    }
  });

  /* =====================================================
     GET /conversations — list user's conversations
  ===================================================== */

  router.get("/conversations", conversationReadLimiter, async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT c.*,
                (SELECT COUNT(*) FROM ai_messages m WHERE m.conversation_id = c.id) AS message_count
         FROM ai_conversations c
         WHERE c.user_id = ?
         ORDER BY c.updated_at DESC
         LIMIT 100`,
        [req.user.id]
      );

      res.json(rows);
    } catch (err) {
      console.error("AI CONVERSATIONS ERROR:", err);
      res.status(500).json({ error: "Failed to fetch conversations" });
    }
  });

  /* =====================================================
     GET /conversations/:id/messages — list messages
  ===================================================== */

  router.get(
    "/conversations/:id/messages",
    conversationReadLimiter,
    async (req, res) => {
    try {
      const [convRows] = await pool.query(
        "SELECT id FROM ai_conversations WHERE id=? AND user_id=?",
        [req.params.id, req.user.id]
      );

      if (!convRows.length) {
        return res.status(404).json({ error: "Conversation not found" });
      }

      /* Read the newest 100 rows first, then re-order them chronologically so
         the API shape and reading order stay identical for the client. Explicit
         columns replace SELECT * so only known message fields are exposed. */
      const [rows] = await pool.query(
        `SELECT recent.id, recent.conversation_id, recent.role,
                recent.content, recent.meta, recent.created_at
         FROM (
           SELECT m.id, m.conversation_id, m.role, m.content, m.meta, m.created_at
           FROM ai_messages m
           WHERE m.conversation_id = ?
           ORDER BY m.created_at DESC, m.id DESC
           LIMIT 100
         ) AS recent
         ORDER BY recent.created_at ASC, recent.id ASC`,
        [req.params.id]
      );

      res.json(rows);
    } catch (err) {
      console.error("AI MESSAGES ERROR:", err);
      res.status(500).json({ error: "Failed to fetch messages" });
    }
  }
  );

  /* =====================================================
     DELETE /conversations/:id — delete conversation + messages
  ===================================================== */

  router.delete(
    "/conversations/:id",
    conversationDeleteLimiter,
    async (req, res) => {
    try {
      const [convRows] = await pool.query(
        "SELECT id FROM ai_conversations WHERE id=? AND user_id=?",
        [req.params.id, req.user.id]
      );

      if (!convRows.length) {
        return res.status(404).json({ error: "Conversation not found" });
      }

      await pool.query(
        "DELETE FROM ai_messages WHERE conversation_id=?",
        [req.params.id]
      );

      await pool.query(
        "DELETE FROM ai_conversations WHERE id=?",
        [req.params.id]
      );

      res.json({ success: true });
    } catch (err) {
      console.error("AI DELETE CONVERSATION ERROR:", err);
      res.status(500).json({ error: "Failed to delete conversation" });
    }
  }
  );

  /* =====================================================
     REGISTER ROUTER
  ===================================================== */

  app.use("/api/ai", authRequired, adminOnly, router);
}
