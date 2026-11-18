import React from "react";

/* Maps a raw status string to a consistent status-badge class.
   Falls back to neutral when unknown. */
export function statusClass(status) {
  const s = (status || "").toLowerCase();
  const map = {
    pending: "status-pending",
    confirmed: "status-confirmed",
    processing: "status-processing",
    shipped: "status-shipped",
    delivered: "status-delivered",
    cancelled: "status-cancelled",
    paid: "status-paid",
    success: "status-paid",
    unpaid: "status-unpaid",
    pending_payment: "status-unpaid",
    failed: "status-failed",
    requested: "status-requested",
    approved: "status-approved",
    received: "status-received",
    refunded: "status-refunded",
    draft: "status-pending",
    sent: "status-confirmed",
    partially_received: "status-processing",
    in_stock: "status-in-stock",
    "in-stock": "status-in-stock",
    low_stock: "status-low-stock",
    "low-stock": "status-low-stock",
    out_of_stock: "status-out-of-stock",
    "out-of-stock": "status-out-of-stock",
  };
  return map[s] || "status-pending";
}

export default function StatusBadge({ status }) {
  const cls = statusClass(status);
  const label = status || "—";
  return <span className={`status-badge ${cls}`}>{String(label).replace(/_/g, " ")}</span>;
}
