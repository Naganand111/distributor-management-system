import React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { statusClass } from "./ui/StatusBadge";

/* Order status labels, step order and colors shared across the app. */
export const ORDER_STATUSES = [
  "pending",
  "processing",
  "confirmed",
  "shipped",
  "delivered",
];

/* Visual step index for a status (delivered has a special happy state). */
export function statusRank(status) {
  switch (status) {
    case "pending": return 1;
    case "processing": return 2;
    case "confirmed": return 2; // legacy, same milestone as processing
    case "shipped": return 3;
    case "delivered": return 4;
    case "cancelled": return -1;
    default: return 0;
  }
}

/* Badge / timeline color per status (maps onto CSS variables for dark mode). */
export function statusColor(status) {
  const g = document.documentElement.getAttribute("data-theme");
  const dark = g === "dark";
  switch (status) {
    case "pending": return { bg: "var(--status-pending-bg)", color: "var(--status-pending)" };
    case "processing": return { bg: "var(--status-processing-bg)", color: "var(--status-processing)" };
    case "confirmed": return { bg: "var(--status-confirmed-bg)", color: "var(--status-confirmed)" };
    case "shipped": return { bg: "var(--status-shipped-bg)", color: "var(--status-shipped)" };
    case "delivered": return { bg: "var(--status-delivered-bg)", color: "var(--status-delivered)" };
    case "cancelled": return { bg: "var(--status-cancelled-bg)", color: "var(--status-cancelled)" };
    default: return { bg: "var(--surface-2)", color: dark ? "#aab4c5" : "#5b6472" };
  }
}

/* A small status pill/badge. */
export function StatusBadge({ status }) {
  return (
    <span className={`status-badge ${statusClass(status)}`}>
      {status}
    </span>
  );
}

/* Visual stepper timeline (pending -> ... -> delivered) with animated connector. */
export default function OrderStatusTimeline({ status, history }) {
  const reduceMotion = useReducedMotion();
  const rank = status === "cancelled" ? -1 : statusRank(status);

  if (status === "cancelled") {
    return (
      <div>
        <div className="otl-steps">
          <motion.div
            className="otl-step-dot otl-cancelled"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 200, damping: 15 }}
          >
            ✕
          </motion.div>
          <span className="otl-cancelled-label">Order Cancelled</span>
        </div>
        {history?.length > 0 && <HistoryList history={history} />}
      </div>
    );
  }

  const activeSteps = Math.max(rank, 0);

  return (
    <div>
      <div className="otl-steps">
        {ORDER_STATUSES.map((s, i) => {
          const active = i + 1 <= activeSteps;
          return (
            <div key={s} className="otl-step">
              {i > 0 && (
                <motion.div
                  className="otl-connector"
                  initial={reduceMotion ? false : { scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: 0.6, delay: 0.2 + i * 0.15, ease: [0.16, 1, 0.3, 1] }}
                />
              )}
              <motion.div
                className={`otl-step-dot ${active ? "active otl-" + s : ""}`}
                initial={reduceMotion ? false : { scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 220, damping: 16, delay: reduceMotion ? 0 : 0.15 + i * 0.15 }}
              >
                {active ? "✓" : i + 1}
              </motion.div>
              <span className={`otl-step-label ${active ? "active" : ""}`}>{s}</span>
            </div>
          );
        })}
      </div>

      {history?.length > 0 && <HistoryList history={history} />}
    </div>
  );
}

function HistoryList({ history }) {
  return (
    <div className="otl-history">
      <p className="otl-history-title">Status History</p>
      {history.map((h) => {
        const c = statusColor(h.status);
        return (
          <div key={h.id} className="otl-history-row">
            <span className="otl-history-dot" style={{ background: c.color }} />
            <div>
              <div className="otl-history-status">{h.status}</div>
              <div className="otl-history-meta">
                {new Date(h.created_at).toLocaleString()}
                {h.note ? ` · ${h.note}` : ""}
                {h.changed_by_name ? ` · by ${h.changed_by_name}` : ""}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
