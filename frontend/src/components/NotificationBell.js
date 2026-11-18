import React, { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Link } from "react-router-dom";
import { FiBell } from "react-icons/fi";
import api from "../lib/api";

export default function NotificationBell() {
  const [count, setCount] = useState(0);
  const [list, setList] = useState([]);
  const [open, setOpen] = useState(false);
  const [userRole, setUserRole] = useState(null);
  const [markingAll, setMarkingAll] = useState(false);
  const ref = useRef(null);

  const load = async () => {
    try {
      const c = await api.get("/notifications/unread-count");
      setCount(c.data.unread || 0);
      const r = await api.get("/notifications?limit=8");
      setList(Array.isArray(r.data) ? r.data : []);
    } catch { /* ignore */ }
  };

  useEffect(() => {
    const u = localStorage.getItem("user");
    try { setUserRole(u ? JSON.parse(u).role : null); } catch { /* ignore */ }
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  /* Re-sync when the notifications page changes read state */
  useEffect(() => {
    const onSync = () => load();
    window.addEventListener("notifications-changed", onSync);
    return () => window.removeEventListener("notifications-changed", onSync);
  }, []);

  useEffect(() => {
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const markAll = async () => {
    setMarkingAll(true);
    try {
      await api.put("/notifications/read-all");
      setCount(0);
      setList((l) => l.map((n) => ({ ...n, is_read: 1 })));
      window.dispatchEvent(new Event("notifications-changed"));
    } catch { /* ignore */ }
    finally { setMarkingAll(false); }
  };

  const markOne = async (id, e) => {
    e.stopPropagation();
    try {
      await api.put(`/notifications/${id}/read`);
      setCount((c) => Math.max(0, c - 1));
      setList((l) => l.map((n) => (n.id === id ? { ...n, is_read: 1 } : n)));
      window.dispatchEvent(new Event("notifications-changed"));
    } catch { /* ignore */ }
  };

  return (
    <div className="notif-bell" ref={ref}>
      <button
        className={`icon-btn ${count > 0 ? "notif-pulse" : ""}`}
        onClick={() => setOpen(!open)}
        aria-label={`Notifications${count > 0 ? `, ${count} unread` : ""}`}
        aria-expanded={open}
      >
        <FiBell />
        {count > 0 && (
          <motion.span
            key={count}
            className="notif-count"
            initial={{ scale: 0.5 }}
            animate={{ scale: 1 }}
          >
            {count > 99 ? "99+" : count}
          </motion.span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="card notif-panel"
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.16 }}
          >
            <div className="card-header d-flex justify-content-between align-items-center">
              <strong>Notifications</strong>
              {count > 0 && (
                <button className="btn btn-sm btn-primary px-3" onClick={markAll} disabled={markingAll}>
                  {markingAll ? "…" : "Mark all read"}
                </button>
              )}
            </div>
            <div className="list-group list-group-flush" style={{ maxHeight: 340, overflow: "auto" }}>
              {list.length === 0 && <div className="list-group-item text-muted">No notifications</div>}
              {list.map((n) => (
                <div
                  key={n.id}
                  className={`list-group-item d-flex justify-content-between align-items-start gap-2 ${!n.is_read ? "notif-unread" : ""}`}
                >
                  <div style={{ minWidth: 0 }}>
                    <div className={`${!n.is_read ? "fw-bold" : "fw-semibold"} small`}>{n.title}</div>
                    <div className="text-muted small text-truncate" style={{ maxWidth: 220 }}>{n.message}</div>
                  </div>
                  {!n.is_read && (
                    <button className="btn btn-sm btn-link p-0 flex-shrink-0" onClick={(e) => markOne(n.id, e)} style={{ fontSize: 11 }}>
                      Read
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className="card-footer">
              <Link
                className="small"
                to={userRole === "admin" ? "/admin/notifications" : "/notifications"}
                onClick={() => setOpen(false)}
              >
                View all notifications →
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`
        .notif-bell { position:relative; display:inline-flex; align-items:center; }
        .notif-panel { position:absolute; right:0; top:48px; width:340px; z-index:1000; box-shadow: var(--shadow-lg);
          border-radius: var(--radius-lg); overflow:hidden; }
        .notif-unread { background: var(--brand-soft); border-left:3px solid var(--brand); }
        .notif-panel .list-group-item { border:none; }
        @media (max-width:560px){ .notif-panel{ width:300px; right:-60px; } }
      `}</style>
    </div>
  );
}
