import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { formatINR } from "../lib/utils";
import { useToast, PageHeader, StatCard, EmptyState } from "./ui";

export default function AdminReorder() {
  const [recs, setRecs] = useState([]);
  const [health, setHealth] = useState(null);
  const [movers, setMovers] = useState(null);
  const [suppliers, setSuppliers] = useState([]);
  const [supplierId, setSupplierId] = useState("");
  const [tab, setTab] = useState("rec");
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  const load = async () => {
    setLoading(true);
    try {
      const [r, h, m, s] = await Promise.all([
        api.get("/reorder/recommendations"),
        api.get("/reorder/health"),
        api.get("/reorder/movers"),
        api.get("/suppliers"),
      ]);
      setRecs(Array.isArray(r.data) ? r.data : []);
      setHealth(h.data);
      setMovers(m.data);
      setSuppliers(Array.isArray(s.data) ? s.data : []);
    } catch (err) {
      console.error("Load reorder:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const saveSettings = async (id, reorder_level, reorder_quantity) => {
    try {
      const res = await api.put(`/reorder/products/${id}/settings`, { reorder_level, reorder_quantity });
      toast.success(res.data?.message || "Reorder settings saved");
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to save settings");
    }
  };

  const createPo = async () => {
    if (!supplierId) return toast.warning("Select a supplier");
    const items = recs.map((p) => ({
      product_id: p.id,
      quantity: Math.max(Number(p.reorder_quantity) || 0, 1),
      purchase_price: Number(p.cost_price) || 0,
    }));
    if (!items.length) return toast.warning("Nothing to order");
    try {
      const res = await api.post("/reorder/purchase-order", { supplier_id: Number(supplierId), items, notes: "Auto from reorder" });
      toast.success(`Purchase order ${res.data.po_number} created`);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to create purchase order");
    }
  };

  const healthCard = (label, value, color) => (
    <div className="col-md-3 mb-3">
      <StatCard label={label} value={value} sub={color.includes("success") ? "In stock" : undefined} />
    </div>
  );

  return (
    <div>
      <PageHeader
        title="Smart Reorder"
        subtitle="Reorder recommendations, stock health, and fast/slow movers."
        actions={<button className="btn btn-outline-secondary" onClick={load}>Refresh</button>}
      />

      <div className="row g-3 mb-4">
        {healthCard("Total Products", health?.total ?? 0, "text-dark")}
        {healthCard("Low Stock", health?.low ?? 0, "text-warning")}
        {healthCard("Out of Stock", health?.outOfStock ?? 0, "text-danger")}
        {healthCard("Healthy", health?.healthy ?? 0, "text-success")}
      </div>

      <ul className="nav nav-pills mb-3">
        {[["rec", "Recommendations"], ["movers", "Fast / Slow Movers"]].map(([k, l]) => (
          <li className="nav-item" key={k}>
            <button className={`btn nav-link ${tab === k ? "active" : ""}`} onClick={() => setTab(k)}>{l}</button>
          </li>
        ))}
      </ul>

      {loading ? (
        <div className="loading">Loading...</div>
      ) : tab === "rec" ? (
        <>
          <div className="card mb-3">
            <div className="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
              <span className="fw-semibold">Reorder Recommendations ({recs.length})</span>
              <div className="d-flex gap-2">
                <select className="form-select form-select-sm" style={{ width: 200 }} value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                  <option value="">Select supplier…</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.company_name || s.name}</option>)}
                </select>
                <button className="btn btn-sm btn-dark" onClick={createPo}>Create PO for all</button>
              </div>
            </div>
            <div className="table-responsive">
              <table className="table table-striped mb-0 align-middle">
                <thead>
                  <tr><th>Product</th><th>SKU</th><th>Stock</th><th>Min</th><th>Reorder Lvl</th><th>Reorder Qty</th><th>Cost</th><th></th></tr>
                </thead>
                <tbody>
                  {recs.map((p) => (
                    <tr key={p.id}>
                      <td className="fw-semibold">{p.name}</td>
                      <td>{p.sku || "—"}</td>
                      <td>{p.stock}</td>
                      <td>{p.effective_reorder_level ?? p.min_stock_level}</td>
                      <td><input className="form-control form-control-sm" style={{ width: 80 }} type="number"
                        defaultValue={p.reorder_level} key={`rl-${p.id}`} id={`rl-${p.id}`} /></td>
                      <td><input className="form-control form-control-sm" style={{ width: 80 }} type="number"
                        defaultValue={p.reorder_quantity} key={`rq-${p.id}`} id={`rq-${p.id}`} /></td>
                      <td>{formatINR(p.cost_price)}</td>
                      <td>
                        <button className="btn btn-sm btn-outline-dark"
                          onClick={() => saveSettings(p.id, document.getElementById(`rl-${p.id}`).value, document.getElementById(`rq-${p.id}`).value)}>
                          Save
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!recs.length && (
                    <tr>
                      <td colSpan="8" className="p-0">
                        <EmptyState title="All products healthy" sub="No products need reordering right now." />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <div className="row">
          <div className="col-md-6 mb-3">
            <div className="card h-100">
              <div className="card-header fw-semibold">Fast Movers</div>
              <div className="table-responsive">
                <table className="table table-sm mb-0">
                  <thead><tr><th>Product</th><th>Units</th><th>Stock</th><th>Cover (mo)</th></tr></thead>
                  <tbody>
                    {(movers?.fastMovers || []).map((m, i) => (
                      <tr key={i}><td>{m.product_name}</td><td>{m.units_sold}</td><td>{m.stock}</td><td>{Number(m.months_of_cover || 0).toFixed(1)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <div className="col-md-6 mb-3">
            <div className="card h-100">
              <div className="card-header fw-semibold">Slow Movers</div>
              <div className="table-responsive">
                <table className="table table-sm mb-0">
                  <thead><tr><th>Product</th><th>Units</th><th>Stock</th><th>Cover (mo)</th></tr></thead>
                  <tbody>
                    {(movers?.slowMovers || []).map((m, i) => (
                      <tr key={i}><td>{m.product_name}</td><td>{m.units_sold}</td><td>{m.stock}</td><td>{Number(m.months_of_cover || 0).toFixed(1)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
