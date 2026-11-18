import React, { useEffect, useRef, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import api from "../../lib/api";
import {
  FiBox, FiUsers, FiShoppingCart, FiFileText, FiShoppingBag,
  FiRotateCcw, FiTruck, FiSearch, FiClock,
} from "react-icons/fi";

const TYPE_ICON = {
  product: <FiBox />,
  retailer: <FiUsers />,
  order: <FiShoppingCart />,
  invoice: <FiFileText />,
  purchase_order: <FiShoppingBag />,
  return: <FiRotateCcw />,
  supplier: <FiTruck />,
};

const TYPE_TO = {
  order: "/admin/order-tracking",
  product: "/admin/products",
  retailer: "/admin/retailers",
  invoice: "/admin/invoices",
  purchase_order: "/admin/purchase-orders",
  return: "/admin/returns",
  supplier: "/admin/suppliers",
};

export default function CommandPalette({ open, onClose, onOpen }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (open) {
      setQ("");
      setItems([]);
      setActive(0);
      setTimeout(() => inputRef.current && inputRef.current.focus(), 30);
    }
  }, [open]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "/" && !open) {
        const tag = (e.target.tagName || "").toLowerCase();
        if (tag !== "input" && tag !== "textarea") { e.preventDefault(); onOpen(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const runSearch = async (query) => {
    if (!query.trim()) { setItems([]); return; }
    setLoading(true);
    try {
      const res = await api.get(`/global-search?q=${encodeURIComponent(query.trim())}`);
      setItems(Array.isArray(res.data.items) ? res.data.items : []);
    } catch { setItems([]); }
    finally { setLoading(false); }
  };

  const grouped = useMemo(() => {
    const g = {};
    items.forEach((it) => { (g[it.type] = g[it.type] || []).push(it); });
    return [
      { key: "product", label: "Products", list: g.product || [] },
      { key: "retailer", label: "Retailers", list: g.retailer || [] },
      { key: "order", label: "Orders", list: g.order || [] },
      { key: "invoice", label: "Invoices", list: g.invoice || [] },
      { key: "purchase_order", label: "Purchase Orders", list: g.purchase_order || [] },
      { key: "supplier", label: "Suppliers", list: g.supplier || [] },
      { key: "return", label: "Returns", list: g.return || [] },
    ].filter((s) => s.list.length);
  }, [items]);

  const flat = useMemo(() => grouped.flatMap((s) => s.list), [grouped]);

  useEffect(() => { setActive(0); }, [q]);

  const pick = (it) => {
    const to = TYPE_TO[it.type];
    if (to) navigate(to);
    onClose();
  };

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, flat.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter" && flat[active]) { e.preventDefault(); pick(flat[active]); }
    else if (e.key === "Escape") { onClose(); }
  };

  if (!open) return null;

  return (
    <div className="cmd-overlay" onClick={onClose}>
      <div className="cmd-box" onClick={(e) => e.stopPropagation()}>
        <div className="cmd-input-row">
          <FiSearch />
          <input
            ref={inputRef}
            placeholder="Search products, orders, invoices, retailers…"
            value={q}
            onChange={(e) => { setQ(e.target.value); runSearch(e.target.value); }}
            onKeyDown={onKeyDown}
            aria-label="Global search"
          />
          <span className="cmd-kbd">ESC</span>
        </div>
        <div className="cmd-results" role="listbox">
          {loading && <div className="cmd-empty">Searching…</div>}
          {!loading && !q.trim() && (
            <div className="cmd-empty">
              <div className="mb-1"><FiClock size={18} /></div>
              Type to search across the entire system
            </div>
          )}
          {!loading && q.trim() && flat.length === 0 && (
            <div className="cmd-empty">No results for “{q}”</div>
          )}
          {grouped.map((section) => (
            <React.Fragment key={section.key}>
              {section.list.length > 0 && <div className="cmd-group-label">{section.label}</div>}
              {section.list.map((it, idx) => {
                const flatIdx = flat.indexOf(it);
                return (
                  <div
                    key={`${section.key}-${it.id}-${idx}`}
                    className={`cmd-item ${flatIdx === active ? "active" : ""}`}
                    onClick={() => pick(it)}
                    onMouseEnter={() => setActive(flatIdx)}
                    role="option"
                    aria-selected={flatIdx === active}
                  >
                    <div className="cmd-item-icon">{TYPE_ICON[it.type] || <FiSearch />}</div>
                    <div>
                      <div style={{ fontWeight: 600 }}>{it.title}</div>
                      <div className="text-muted" style={{ fontSize: 12.5 }}>{it.subtitle}</div>
                    </div>
                  </div>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}
