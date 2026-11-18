import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import api from "../lib/api";
import { timeAgo } from "../lib/utils";

const TYPE_LABEL = {
  order: "Order", payment: "Payment", delivery: "Delivery", low_stock: "Low Stock",
  expiry: "Expiry", return: "Return", credit: "Credit", collection: "Collection", system: "System",
};

export default function CustomerNotifications() {
  const [notifs, setNotifs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [markingAll, setMarkingAll] = useState(false);
  const [filter, setFilter] = useState("all");

  const load = async () => {
    try {
      const res = await api.get("/notifications?limit=200");
      setNotifs(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error("Load notifications:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);
  useEffect(() => {
    const onSync = () => load();
    window.addEventListener("notifications-changed", onSync);
    return () => window.removeEventListener("notifications-changed", onSync);
  }, []);

  const notifyChanged = () => window.dispatchEvent(new Event("notifications-changed"));

  const markRead = async (id) => {
    try {
      await api.put(`/notifications/${id}/read`);
      setNotifs((n) => n.map((x) => (x.id === id ? { ...x, is_read: 1 } : x)));
      notifyChanged();
    } catch { /* ignore */ }
  };

  const markAll = async () => {
    setMarkingAll(true);
    try {
      await api.put("/notifications/read-all");
      setNotifs((n) => n.map((x) => ({ ...x, is_read: 1 })));
      notifyChanged();
    } catch (err) {
      console.error("Mark all read:", err);
    } finally {
      setMarkingAll(false);
    }
  };

  const remove = async (id) => {
    try { await api.delete(`/notifications/${id}`); setNotifs((n) => n.filter((x) => x.id !== id)); notifyChanged(); } catch { /* ignore */ }
  };

  const typeClass = {
    order: "bg-primary", payment: "bg-success", delivery: "bg-info",
    low_stock: "bg-warning", expiry: "bg-danger", return: "bg-secondary",
    credit: "bg-dark", collection: "bg-success", system: "bg-secondary",
  };

  if (loading) return <div className="text-center py-5 text-muted">Loading notifications…</div>;

  const unread = notifs.filter((n) => !n.is_read).length;
  const categories = ["all", ...new Set(notifs.map((n) => n.type))];
  const visible = filter === "all" ? notifs : notifs.filter((n) => n.type === filter);

  return (
    <div>
      <div className="d-flex flex-wrap justify-content-between align-items-center gap-3 mb-4">
        <div>
          <h3 className="cust-page-title mb-1">Notifications</h3>
          <p className="text-muted mb-0">
            {unread > 0 ? `${unread} unread` : "You're all caught up"}
          </p>
        </div>
        {unread > 0 && (
          <button
            className="btn btn-primary customer-btn px-4"
            onClick={markAll}
            disabled={markingAll}
          >
            {markingAll ? "Marking…" : `Mark all read (${unread})`}
          </button>
        )}
      </div>

      {notifs.length === 0 ? (
        <div className="text-center py-5">
          <div style={{ fontSize: 56 }} role="img" aria-label="No notifications">🔔</div>
          <h4 className="mt-3">No notifications</h4>
          <p className="text-muted">Notifications about your orders, payments and updates appear here.</p>
        </div>
      ) : (
        <>
          {/* FILTER TABS */}
          <div className="d-flex flex-wrap gap-2 mb-3">
            {categories.map((cat) => {
              const count = cat === "all" ? notifs.length : notifs.filter((n) => n.type === cat).length;
              return (
                <button
                  key={cat}
                  className={`btn btn-sm px-3 ${filter === cat ? "btn-primary" : "btn-outline-secondary"}`}
                  onClick={() => setFilter(cat)}
                >
                  {cat === "all" ? "All" : TYPE_LABEL[cat] || cat} ({count})
                </button>
              );
            })}
          </div>

          <div className="notif-list">
            <AnimatePresence initial={false}>
              {visible.map((n) => (
                <motion.div
                  key={n.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.25 }}
                  className={`notif-item ${!n.is_read ? "notif-item-unread" : "notif-item-read"}`}
                >
                  <div className="notif-body">
                    <div className="d-flex align-items-center gap-2">
                      <span className={`badge ${typeClass[n.type] || "bg-secondary"}`}>{TYPE_LABEL[n.type] || n.type}</span>
                      {!n.is_read && <span className="notif-dot" aria-label="Unread" />}
                    </div>
                    <div className={`notif-title ${!n.is_read ? "fw-bold" : ""}`}>{n.title}</div>
                    <div className="notif-msg">{n.message}</div>
                    <div className="notif-date">{timeAgo(n.created_at)}</div>
                  </div>
                  <div className="notif-actions">
                    {!n.is_read && (
                      <button className="btn btn-sm btn-outline-primary" onClick={() => markRead(n.id)}>Mark read</button>
                    )}
                    <button className="btn btn-sm btn-outline-danger" onClick={() => remove(n.id)}>Delete</button>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
            {visible.length === 0 && (
              <div className="text-center py-4 text-muted">No {filter === "all" ? "" : TYPE_LABEL[filter] + " "}notifications.</div>
            )}
          </div>
        </>
      )}

      <style>{`
        .customer-btn{border-radius:999px;}
        .notif-list{ display:flex; flex-direction:column; gap:10px; }
        .notif-item{ display:flex; justify-content:space-between; align-items:flex-start; gap:12px;
          padding:14px 16px; border-radius:var(--radius-lg); border:1px solid var(--border);
          background:var(--surface); box-shadow:var(--shadow-sm); }
        .notif-item-unread{ background:var(--brand-soft); border-left:3px solid var(--brand); }
        .notif-item-read{ opacity:.88; }
        .notif-body{ flex:1; min-width:0; }
        .notif-title{ color:var(--text); margin-top:4px; }
        .notif-msg{ color:var(--text-secondary); font-size:13.5px; margin-top:2px; }
        .notif-date{ color:var(--text-muted); font-size:12px; margin-top:6px; }
        .notif-dot{ width:8px; height:8px; border-radius:50%; background:var(--brand); flex-shrink:0;
          box-shadow:0 0 0 3px var(--brand-soft); }
        .notif-actions{ display:flex; flex-direction:column; gap:6px; flex-shrink:0; }
        @media (max-width:480px){ .notif-item{ flex-direction:column; } .notif-actions{ flex-direction:row; } }
      `}</style>
    </div>
  );
}
