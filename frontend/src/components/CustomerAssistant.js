import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import api from "../lib/api";
import { formatINR, formatDate } from "../lib/utils";
import { StatusBadge, PageTransition, useToast } from "./ui";
import {
  FiSend,
  FiMessageCircle,
  FiPlus,
  FiClock,
  FiChevronLeft,
  FiX,
  FiTrash2,
  FiFileText,
  FiShoppingBag,
  FiCreditCard,
  FiRefreshCw,
} from "react-icons/fi";

const MAX_MESSAGE_LENGTH = 2000;

const QUICK_PROMPTS = [
  { label: "My Orders", query: "Show my orders", icon: <FiShoppingBag /> },
  { label: "Track Order", query: "Show my latest order", icon: <FiClock /> },
  { label: "My Payments", query: "Show my payments", icon: <FiCreditCard /> },
  { label: "My Invoices", query: "Show my invoices", icon: <FiFileText /> },
  { label: "Recent Purchases", query: "Show my recent purchases", icon: <FiRefreshCw /> },
];

const titleCase = (v) =>
  String(v || "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

/* Only fields returned by the backend are rendered. */
const netTotal = (order) => (order.net_total !== undefined ? order.net_total : order.total_amount);

function OrderCard({ order }) {
  return (
    <div className="cai-order">
      <div className="cai-order-head">
        <span className="cai-order-id">Order #{order.id}</span>
        <StatusBadge status={order.status} />
      </div>
      <div className="cai-order-grid">
        <div>
          <span className="cai-k">Date</span>
          <span className="cai-v">{formatDate(order.created_at)}</span>
        </div>
        <div>
          <span className="cai-k">Items</span>
          <span className="cai-v">{order.item_count} item(s)</span>
        </div>
        <div>
          <span className="cai-k">Total</span>
          <span className="cai-v">{formatINR(Number(netTotal(order)))}</span>
        </div>
        <div>
          <span className="cai-k">Payment</span>
          <span className="cai-v">{titleCase(order.payment_status)}</span>
        </div>
      </div>
      {order.invoice_no && <div className="cai-order-inv">Invoice {order.invoice_no}</div>}
    </div>
  );
}

function OrderItemCard({ order, items, history }) {
  return (
    <div className="cai-order">
      <div className="cai-order-head">
        <span className="cai-order-id">Order #{order.id}</span>
        <StatusBadge status={order.status} />
      </div>
      <div className="cai-order-grid">
        <div>
          <span className="cai-k">Date</span>
          <span className="cai-v">{formatDate(order.created_at)}</span>
        </div>
        <div>
          <span className="cai-k">Total</span>
          <span className="cai-v">{formatINR(Number(netTotal(order)))}</span>
        </div>
        <div>
          <span className="cai-k">Payment</span>
          <span className="cai-v">{titleCase(order.payment_status)}</span>
        </div>
        <div>
          <span className="cai-k">Items</span>
          <span className="cai-v">{order.item_count} item(s)</span>
        </div>
      </div>

      {Array.isArray(items) && items.length > 0 && (
        <ul className="cai-items">
          {items.map((it, i) => (
            <li key={`${order.id}-${i}`}>
              <span>{it.name}</span>
              <span className="cai-items-meta">
                {it.quantity} × {formatINR(Number(it.price))}
              </span>
            </li>
          ))}
        </ul>
      )}

      {Array.isArray(history) && history.length > 0 && (
        <div className="cai-track">
          {history.map((h, i) => (
            <span key={`${order.id}-h-${i}`} className="cai-step">
              <span className="cai-step-dot" />
              {titleCase(h.status)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function PaymentCard({ summary, payments }) {
  return (
    <div className="cai-order">
      <div className="cai-pay-summary">
        <div>
          <span className="cai-k">Paid</span>
          <span className="cai-v cai-v-lg">{formatINR(Number(summary.paid))}</span>
        </div>
        <div>
          <span className="cai-k">Outstanding</span>
          <span className="cai-v cai-v-lg">{formatINR(Number(summary.outstanding))}</span>
        </div>
        <div>
          <span className="cai-k">Orders</span>
          <span className="cai-v cai-v-lg">{summary.orders}</span>
        </div>
      </div>
      {Array.isArray(payments) && payments.length > 0 && (
        <ul className="cai-items">
          {payments.map((p) => (
            <li key={p.payment_id}>
              <span>
                {formatINR(Number(p.amount))} · {titleCase(p.method)}
              </span>
              <span className="cai-items-meta">Order #{p.order_id}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function InvoiceList({ invoices }) {
  const navigate = useNavigate();
  if (!Array.isArray(invoices) || invoices.length === 0) return null;
  return (
    <div className="cai-order">
      <ul className="cai-items">
        {invoices.map((inv) => (
          <li key={inv.invoice_no}>
            <span>
              {inv.invoice_no} · {formatINR(Number(inv.grand_total))}
            </span>
            <span className="cai-items-meta">
              {formatDate(inv.invoice_date)} · {titleCase(inv.payment_status)}
              <button
                type="button"
                className="cai-link"
                onClick={() => navigate(`/invoice/${inv.order_id}`)}
              >
                View Invoice
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* Renders the structured payload the backend returned for the last answer. */
function DataBlock({ payload, intent }) {
  if (!payload) return null;

  if ((intent === "track_order" || intent === "recent_purchases") && Array.isArray(payload.orders)) {
    if (payload.orders.length === 0) return null;
    if (intent === "track_order") {
      const order = payload.orders[0];
      return <OrderItemCard order={order} items={payload.items} history={payload.history} />;
    }
    /* recent_purchases returns items keyed by order id. */
    return (
      <>
        {payload.orders.map((o) => (
          <OrderItemCard
            key={o.id}
            order={o}
            items={payload.items && payload.items[o.id] ? payload.items[o.id] : []}
          />
        ))}
      </>
    );
  }

  if (intent === "my_orders" && Array.isArray(payload.orders)) {
    if (payload.orders.length === 0) return null;
    return (
      <>
        {payload.orders.map((o) => (
          <OrderCard key={o.id} order={o} />
        ))}
      </>
    );
  }

  if (intent === "my_payments" && payload.summary) {
    return <PaymentCard summary={payload.summary} payments={payload.payments} />;
  }

  if (intent === "my_invoices") {
    return <InvoiceList invoices={payload.invoices} />;
  }

  return null;
}

/* Stored assistant rows keep intent + payload in the single `meta` JSON column.
   Reading `row.intent` / `row.data` directly silently loses both on reload, so
   they are unpacked here. Mirrors parseMeta in AdminAssistant. */
function parseStoredMessage(row) {
  if (!row || row.role !== "assistant") {
    return { role: row?.role || "assistant", content: row?.content || "" };
  }

  let meta = null;
  if (row.meta) {
    try {
      meta = typeof row.meta === "string" ? JSON.parse(row.meta) : row.meta;
    } catch {
      meta = null;
    }
  }

  return {
    role: "assistant",
    content: row.content || "",
    intent: meta?.intent || null,
    data: meta && meta.data !== undefined ? meta.data : null,
  };
}

export default function CustomerAssistant() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToast();

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [conversations, setConversations] = useState([]);
  const [pendingPrompt, setPendingPrompt] = useState(null);

  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const promptHandled = useRef(false);
  const inFlight = useRef(false);

  useEffect(() => {
    const el = bottomRef.current;
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages, loading]);

  const loadConversations = useCallback(async () => {
    try {
      const res = await api.get("/customer-ai/conversations");
      setConversations(Array.isArray(res.data) ? res.data : []);
    } catch {
      setConversations([]);
    }
  }, []);

  const openConversation = useCallback(async (id) => {
    setLoading(true);
    try {
      const res = await api.get(`/customer-ai/conversations/${id}/messages`);
      const rows = Array.isArray(res.data) ? res.data : [];
      setMessages(rows.map(parseStoredMessage));
      setConversationId(id);
      setHistoryOpen(false);
    } catch {
      toast.error("Could not open that conversation");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const deleteConversation = useCallback(
    async (id) => {
      try {
        await api.delete(`/customer-ai/conversations/${id}`);
        if (id === conversationId) {
          setMessages([]);
          setConversationId(null);
        }
        loadConversations();
      } catch {
        toast.error("Could not delete that conversation");
      }
    },
    [conversationId, loadConversations, toast]
  );

  const newChat = useCallback(() => {
    setMessages([]);
    setConversationId(null);
    setInput("");
    setHistoryOpen(false);
    inputRef.current?.focus();
  }, []);

  /* Sends a question. No customer id / user id is ever sent: the backend
     always uses the authenticated session. */
  const send = useCallback(
    async (raw) => {
      const text = String(raw ?? "").trim();
      if (!text || loading || inFlight.current) return;
      if (text.length > MAX_MESSAGE_LENGTH) {
        toast.error(`Message must be ${MAX_MESSAGE_LENGTH} characters or fewer`);
        return;
      }

      inFlight.current = true;
      setInput("");
      setPendingPrompt(null);
      setLoading(true);
      setMessages((prev) => [...prev, { role: "user", content: text }]);

      try {
        const body = { message: text };
        if (conversationId) body.conversationId = conversationId;
        const res = await api.post("/customer-ai/query", body);
        const payload = res.data?.data || {};
        setConversationId(payload.conversationId ?? conversationId);
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: payload.answer || "",
            intent: payload.intent,
            data: payload.data,
          },
        ]);
      } catch (err) {
        const status = err?.response?.status;
        const message =
          status === 403
            ? "You do not have permission to use the assistant. Please sign in with an authorised account."
            : status === 429
            ? "You are asking a lot of questions. Please wait a moment and try again."
            : err?.code === "ECONNABORTED"
            ? "That took too long to answer. Please try again."
            : status
            ? "Sorry, I could not answer that right now. Please try again."
            : "I could not reach the assistant. Please check your connection and try again.";
        setMessages((prev) => [...prev, { role: "assistant", content: message, error: true }]);
      } finally {
        inFlight.current = false;
        setLoading(false);
      }
    },
    [conversationId, loading, toast]
  );

  /* Quick prompts from the dashboard arrive as ?q=... in the URL, but a query
     string is fully attacker-controllable. It must never be sent on its own:
     it is loaded into the composer and the customer has to confirm it. */
  useEffect(() => {
    const q = searchParams.get("q");
    if (!q || promptHandled.current) return;
    promptHandled.current = true;
    setSearchParams({}, { replace: true });
    const text = String(q).slice(0, MAX_MESSAGE_LENGTH);
    setInput(text);
    setPendingPrompt(text);
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (historyOpen) loadConversations();
  }, [historyOpen, loadConversations]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  };

  const empty = messages.length === 0;

  return (
    <PageTransition>
      <div className="cai-wrap">
        <style>{CUSTOMER_AI_CSS}</style>

        {/* HEADER */}
        <div className="cai-head">
          <button
            type="button"
            className="cai-icon-btn"
            onClick={() => navigate("/customer-dashboard")}
            aria-label="Back to dashboard"
            title="Back to dashboard"
          >
            <FiChevronLeft />
          </button>

          <div className="cai-head-text">
            <h2 className="cai-title">
              <FiMessageCircle /> AI Assistant
            </h2>
            <div className="cai-sub">Ask about your orders, payments and purchases</div>
          </div>

          <span className="cai-online">
            <span className="cai-dot" /> Online
          </span>

          <div className="cai-head-actions">
            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={newChat}>
              <FiPlus /> New Chat
            </button>
            <button
              type="button"
              className="btn btn-sm btn-outline-secondary"
              onClick={() => setHistoryOpen((v) => !v)}
              aria-expanded={historyOpen}
            >
              <FiClock /> History
            </button>
          </div>
        </div>

        {/* CONVERSATION HISTORY */}
        {historyOpen && (
          <div className="cai-history">
            <div className="cai-history-head">
              <span>Conversation History</span>
              <button
                type="button"
                className="cai-icon-btn"
                onClick={() => setHistoryOpen(false)}
                aria-label="Close history"
              >
                <FiX />
              </button>
            </div>
            {conversations.length === 0 ? (
              <div className="cai-history-empty">No conversations yet.</div>
            ) : (
              <ul className="cai-history-list">
                {conversations.map((c) => (
                  <li key={c.id} className={c.id === conversationId ? "cai-active" : ""}>
                    <button type="button" className="cai-history-open" onClick={() => openConversation(c.id)}>
                      <span className="cai-history-title">{c.title}</span>
                      <span className="cai-history-date">{formatDate(c.updated_at)}</span>
                    </button>
                    <button
                      type="button"
                      className="cai-icon-btn cai-icon-btn-sm"
                      onClick={() => deleteConversation(c.id)}
                      aria-label="Delete conversation"
                      title="Delete conversation"
                    >
                      <FiTrash2 />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* MESSAGES */}
        <div className="cai-body">
          {empty ? (
            <div className="cai-welcome">
              <div className="cai-welcome-badge">
                <FiMessageCircle />
              </div>
              <h3>Hi! I am your personal shopping assistant.</h3>
              <p>
                I can help you check your orders, track the status of your latest order, review
                payments and invoices, and summarise your recent purchases.
              </p>
              <div className="cai-prompts">
                {QUICK_PROMPTS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    className="cai-prompt"
                    onClick={() => send(p.query)}
                  >
                    {p.icon}
                    <span>{p.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="cai-thread">
              {messages.map((m, i) => (
                <div key={i} className={`cai-msg ${m.role === "user" ? "cai-msg-user" : "cai-msg-bot"}`}>
                  {m.role === "assistant" && <div className="cai-msg-avatar"><FiMessageCircle /></div>}
                  <div className="cai-bubble">
                    <div className="cai-text">{m.content}</div>
                    {m.role === "assistant" && <DataBlock payload={m.data} intent={m.intent} />}
                  </div>
                </div>
              ))}
              {loading && (
                <div className="cai-msg cai-msg-bot">
                  <div className="cai-msg-avatar"><FiMessageCircle /></div>
                  <div className="cai-bubble cai-bubble-loading">
                    <span className="cai-typing">
                      <i />
                      <i />
                      <i />
                    </span>
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* COMPOSER */}
        <div className="cai-composer">
          {pendingPrompt && (
            <div className="cai-confirm" role="alert">
              <div className="cai-confirm-head">
                <span>Run this question? It came from a link, so please check it first.</span>
                <button
                  type="button"
                  className="cai-icon-btn cai-icon-btn-sm"
                  onClick={() => setPendingPrompt(null)}
                  aria-label="Discard this question"
                  title="Discard"
                >
                  <FiX />
                </button>
              </div>
              <div className="cai-confirm-body">
                <code className="cai-confirm-q">{pendingPrompt}</code>
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  onClick={() => send(pendingPrompt)}
                  disabled={loading}
                >
                  <FiSend /> Ask now
                </button>
              </div>
            </div>
          )}
          {historyOpen && conversations.length > 0 && (
            <div className="cai-quick-row">
              {QUICK_PROMPTS.slice(0, 3).map((p) => (
                <button key={p.label} type="button" className="cai-chip" onClick={() => send(p.query)}>
                  {p.label}
                </button>
              ))}
            </div>
          )}
          <div className="cai-input-row">
            <textarea
              ref={inputRef}
              className="cai-input"
              rows={1}
              value={input}
              placeholder="Ask about your orders, payments or purchases…"
              maxLength={MAX_MESSAGE_LENGTH}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
            />
            <button
              type="button"
              className="cai-send"
              onClick={() => send(input)}
              disabled={loading || !input.trim()}
              aria-label="Send message"
              title="Send"
            >
              <FiSend />
            </button>
          </div>
          <div className="cai-hint">Press Enter to send · Shift + Enter for a new line</div>
        </div>
      </div>
    </PageTransition>
  );
}

const CUSTOMER_AI_CSS = `
.cai-wrap {
  display: flex;
  flex-direction: column;
  min-height: calc(100vh - var(--header-h, 64px) - var(--content-pad, 28px) * 2);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg, 14px);
  box-shadow: var(--shadow-sm);
  overflow: hidden;
  position: relative;
}
.cai-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  flex-wrap: wrap;
}
.cai-head-text { flex: 1 1 220px; min-width: 0; }
.cai-title { display: flex; align-items: center; gap: 8px; font-size: 1.05rem; font-weight: 700; margin: 0; color: var(--text); }
.cai-sub { font-size: .8rem; color: var(--text-muted); }
.cai-online {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: .75rem; font-weight: 600; color: var(--success);
  background: var(--success-bg); padding: 4px 10px; border-radius: var(--radius-pill, 999px);
}
.cai-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--success); display: inline-block; }
.cai-head-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.cai-icon-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 34px; height: 34px; border-radius: var(--radius-sm, 6px);
  border: 1px solid var(--border); background: var(--surface); color: var(--text-secondary); cursor: pointer;
}
.cai-icon-btn:hover { background: var(--surface-hover); color: var(--text); }
.cai-icon-btn-sm { width: 28px; height: 28px; }
.cai-history {
  position: absolute; top: 66px; right: 0; z-index: 20;
  width: 320px; max-width: 100%;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius, 10px);
  box-shadow: var(--shadow-lg);
  max-height: 60vh; display: flex; flex-direction: column; overflow: hidden;
}
.cai-history-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 12px; border-bottom: 1px solid var(--border);
  font-weight: 600; font-size: .85rem; color: var(--text);
}
.cai-history-empty { padding: 16px; font-size: .82rem; color: var(--text-muted); }
.cai-history-list { list-style: none; margin: 0; padding: 6px; overflow-y: auto; }
.cai-history-list li { display: flex; align-items: center; gap: 6px; border-radius: var(--radius-sm, 6px); }
.cai-history-list li:hover { background: var(--surface-hover); }
.cai-history-list li.cai-active { background: var(--brand-soft); }
.cai-history-open {
  flex: 1; min-width: 0; text-align: left; background: none; border: 0;
  padding: 8px 10px; cursor: pointer; color: var(--text);
  display: flex; flex-direction: column; gap: 2px;
}
.cai-history-title { font-size: .82rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cai-history-date { font-size: .7rem; color: var(--text-muted); }
.cai-body { flex: 1; overflow-y: auto; padding: 18px; }
.cai-welcome { max-width: 640px; margin: 0 auto; text-align: center; padding: 24px 8px; }
.cai-welcome-badge {
  width: 56px; height: 56px; margin: 0 auto 14px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 50%; color: #fff; font-size: 24px; background: var(--brand);
}
.cai-welcome h3 { font-size: 1.1rem; font-weight: 700; color: var(--text); margin-bottom: 6px; }
.cai-welcome p { color: var(--text-muted); font-size: .87rem; margin-bottom: 18px; }
.cai-prompts { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
.cai-prompt {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 8px 14px; border-radius: var(--radius-pill, 999px);
  border: 1px solid var(--border-strong); background: var(--surface);
  color: var(--text); font-size: .82rem; font-weight: 600; cursor: pointer;
}
.cai-prompt:hover { border-color: var(--brand); color: var(--brand); background: var(--brand-soft); }
.cai-thread { display: flex; flex-direction: column; gap: 14px; max-width: 860px; margin: 0 auto; }
.cai-msg { display: flex; gap: 10px; align-items: flex-start; }
.cai-msg-user { justify-content: flex-end; }
.cai-msg-avatar {
  width: 30px; height: 30px; flex: 0 0 30px; border-radius: 50%;
  background: var(--brand); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 14px;
}
.cai-bubble {
  max-width: 78%; padding: 10px 13px; border-radius: 12px;
  background: var(--surface-hover); border: 1px solid var(--border);
  color: var(--text); font-size: .88rem; line-height: 1.55; white-space: pre-wrap; word-break: break-word;
}
.cai-msg-user .cai-bubble { background: var(--brand); border-color: var(--brand); color: #fff; }
.cai-bubble-loading { min-width: 62px; }
.cai-typing { display: inline-flex; gap: 4px; }
.cai-typing i {
  width: 6px; height: 6px; border-radius: 50%; background: var(--text-muted);
  animation: cai-blink 1.1s infinite ease-in-out;
}
.cai-typing i:nth-child(2) { animation-delay: .18s; }
.cai-typing i:nth-child(3) { animation-delay: .36s; }
@keyframes cai-blink { 0%, 80%, 100% { opacity: .25; } 40% { opacity: 1; } }
.cai-order {
  margin-top: 10px; border: 1px solid var(--border); border-radius: var(--radius, 10px);
  background: var(--surface); padding: 12px; text-align: left; white-space: normal;
}
.cai-order-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
.cai-order-id { font-weight: 700; font-size: .85rem; color: var(--text); }
.cai-order-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 10px; }
.cai-pay-summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 10px; margin-bottom: 8px; }
.cai-k { display: block; font-size: .68rem; text-transform: uppercase; letter-spacing: .04em; color: var(--text-muted); }
.cai-v { display: block; font-size: .84rem; font-weight: 600; color: var(--text); }
.cai-v-lg { font-size: 1rem; }
.cai-order-inv { margin-top: 10px; font-size: .76rem; color: var(--text-secondary); }
.cai-items { list-style: none; margin: 10px 0 0; padding: 0; border-top: 1px dashed var(--border); }
.cai-items li {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 7px 0; font-size: .8rem; color: var(--text);
  border-bottom: 1px solid var(--border);
}
.cai-items li:last-child { border-bottom: 0; }
.cai-items-meta { color: var(--text-muted); font-size: .75rem; display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.cai-track { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.cai-step {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: .72rem; color: var(--text-secondary);
  background: var(--surface-hover); border: 1px solid var(--border);
  padding: 3px 9px; border-radius: var(--radius-pill, 999px);
}
.cai-step-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--brand); }
.cai-link {
  background: none; border: 0; padding: 0; cursor: pointer;
  color: var(--brand); font-size: .75rem; font-weight: 600; text-decoration: underline;
}
.cai-composer { border-top: 1px solid var(--border); padding: 12px 14px; background: var(--surface); }
.cai-quick-row { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
.cai-chip {
  border: 1px solid var(--border-strong); background: var(--surface); color: var(--text-secondary);
  border-radius: var(--radius-pill, 999px); padding: 4px 11px; font-size: .75rem; cursor: pointer;
}
.cai-chip:hover { border-color: var(--brand); color: var(--brand); }
.cai-confirm {
  border: 1px solid var(--border-strong); border-left: 3px solid var(--brand);
  border-radius: var(--radius, 10px); background: var(--surface-alt, var(--surface));
  padding: 10px 12px; margin-bottom: 10px;
}
.cai-confirm-head {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 8px;
  font-size: .78rem; color: var(--text-secondary); margin-bottom: 8px;
}
.cai-confirm-body { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.cai-confirm-q {
  flex: 1; min-width: 0; font-size: .82rem; color: var(--text);
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius-sm, 8px); padding: 6px 9px;
  overflow-wrap: anywhere;
}
.cai-input-row { display: flex; gap: 10px; align-items: flex-end; }
.cai-input {
  flex: 1; resize: none; max-height: 130px;
  border: 1px solid var(--border-strong); border-radius: var(--radius, 10px);
  padding: 10px 12px; font: inherit; font-size: .88rem; line-height: 1.5;
  color: var(--text); background: var(--surface);
}
.cai-input:focus { outline: none; border-color: var(--brand); box-shadow: var(--ring); }
.cai-send {
  width: 42px; height: 42px; flex: 0 0 42px; border-radius: 50%; border: 0;
  background: var(--brand); color: #fff; display: flex; align-items: center; justify-content: center; cursor: pointer;
}
.cai-send:disabled { opacity: .45; cursor: not-allowed; }
.cai-send:hover:not(:disabled) { background: var(--brand-strong); }
.cai-hint { font-size: .72rem; color: var(--text-muted); margin-top: 7px; }
@media (max-width: 768px) {
  .cai-wrap { min-height: calc(100vh - var(--header-h, 64px) - 20px); border-radius: var(--radius, 10px); }
  .cai-head { padding: 12px; gap: 10px; }
  .cai-head-actions { width: 100%; }
  .cai-head-actions .btn { flex: 1; }
  .cai-online { order: 3; }
  .cai-body { padding: 12px; }
  .cai-bubble { max-width: 92%; }
  .cai-history { width: 100%; right: 0; left: 0; border-radius: 0; border-left: 0; border-right: 0; }
  .cai-order-grid, .cai-pay-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .cai-welcome { padding: 12px 4px; }
  .cai-prompts { gap: 6px; }
  .cai-prompt { padding: 7px 11px; font-size: .78rem; }
}
`;
