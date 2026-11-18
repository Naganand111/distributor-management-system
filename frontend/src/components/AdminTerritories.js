import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { useToast, ConfirmModal } from "./ui";

export default function AdminTerritories() {
  const [territories, setTerritories] = useState([]);
  const [performance, setPerformance] = useState([]);
  const [reps, setReps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [deleteId, setDeleteId] = useState(null);
  const toast = useToast();
  const [form, setForm] = useState({
    name: "", code: "", state: "", district: "", city: "",
    description: "", manager_id: "", status: "active",
  });

  const load = async () => {
    setLoading(true);
    try {
      const [t, p, r] = await Promise.all([
        api.get("/territories"),
        api.get("/territories/performance"),
        api.get("/sales-representatives"),
      ]);
      setTerritories(Array.isArray(t.data) ? t.data : []);
      setPerformance(Array.isArray(p.data) ? p.data : []);
      setReps(Array.isArray(r.data) ? r.data : []);
    } catch (err) {
      console.error("Load territories error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    try {
      if (editing) {
        await api.put(`/territories/${editing.id}`, form);
      } else {
        await api.post("/territories", form);
      }
      setEditing(null);
      setForm({ name: "", code: "", state: "", district: "", city: "", description: "", manager_id: "", status: "active" });
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to save");
    }
  };

  const remove = async () => {
    try {
      await api.delete(`/territories/${deleteId}`);
      toast.success("Territory deleted");
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || "Delete failed");
    } finally {
      setDeleteId(null);
    }
  };

  const [products, setProducts] = useState(null);
  const showProducts = async (t) => {
    const res = await api.get(`/territories/${t.id}/products`);
    setProducts({ territory: t.name, products: res.data });
  };

  const fmt = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

  return (
    <div className="container-fluid py-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h2 className="mb-0">Territories</h2>
        <button className="btn btn-outline-secondary" onClick={load}>Refresh</button>
      </div>

      {loading ? (
        <div className="loading">Loading...</div>
      ) : (
        <div className="row">
          <div className="col-md-8">
            <div className="card shadow-sm mb-4">
              <div className="card-header bg-white fw-semibold">Performance Overview</div>
              <div className="table-responsive">
                <table className="table table-striped mb-0 align-middle">
                  <thead>
                    <tr>
                      <th>Territory</th>
                      <th>Retailers</th>
                      <th>Orders</th>
                      <th>Revenue</th>
                      <th>Pending</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {performance.map((p) => (
                      <tr key={p.id}>
                        <td>{p.name}</td>
                        <td>{p.total_retailers}</td>
                        <td>{p.total_orders}</td>
                        <td>{fmt(p.revenue)}</td>
                        <td>{fmt(p.pending_payments)}</td>
                        <td>
                          <button className="btn btn-sm btn-outline-secondary" onClick={() => showProducts(p)}>
                            Top Products
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="card shadow-sm">
              <div className="card-header bg-white fw-semibold">Territory List</div>
              <div className="table-responsive">
                <table className="table table-striped mb-0 align-middle">
                  <thead>
                    <tr>
                      <th>Name</th><th>Code</th><th>State</th><th>District</th>
                      <th>Manager</th><th>Status</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {territories.map((t) => (
                      <tr key={t.id}>
                        <td>{t.name}</td>
                        <td>{t.code || "—"}</td>
                        <td>{t.state || "—"}</td>
                        <td>{t.district || "—"}</td>
                        <td>{t.manager_name || "—"}</td>
                        <td><span className={`status ${t.status}`}>{t.status}</span></td>
                        <td className="text-end">
                          <button className="btn btn-sm btn-outline-primary me-1"
                            onClick={() => { setEditing(t); setForm({ ...t, manager_id: t.manager_id || "" }); }}>
                            Edit
                          </button>
                          <button className="btn btn-sm btn-outline-danger" onClick={() => setDeleteId(t.id)}>Del</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="col-md-4">
            <div className="card shadow-sm">
              <div className="card-header bg-white fw-semibold">
                {editing ? `Edit: ${editing.name}` : "Add Territory"}
              </div>
              <div className="card-body">
                <form onSubmit={submit}>
                  <label className="small">Name *</label>
                  <input className="form-control mb-2" required value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })} />
                  <div className="row">
                    <div className="col-6">
                      <label className="small">Code</label>
                      <input className="form-control mb-2" value={form.code}
                        onChange={(e) => setForm({ ...form, code: e.target.value })} />
                    </div>
                    <div className="col-6">
                      <label className="small">City</label>
                      <input className="form-control mb-2" value={form.city}
                        onChange={(e) => setForm({ ...form, city: e.target.value })} />
                    </div>
                  </div>
                  <label className="small">State</label>
                  <input className="form-control mb-2" value={form.state}
                    onChange={(e) => setForm({ ...form, state: e.target.value })} />
                  <label className="small">District</label>
                  <input className="form-control mb-2" value={form.district}
                    onChange={(e) => setForm({ ...form, district: e.target.value })} />
                  <label className="small">Manager</label>
                  <select className="form-select mb-2" value={form.manager_id}
                    onChange={(e) => setForm({ ...form, manager_id: e.target.value })}>
                    <option value="">— None —</option>
                    {reps.map((r) => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                  <label className="small">Description</label>
                  <textarea className="form-control mb-2" value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })} />
                  <div className="form-check mb-3">
                    <input className="form-check-input" type="checkbox"
                      checked={form.status === "active"}
                      onChange={(e) => setForm({ ...form, status: e.target.checked ? "active" : "inactive" })} />
                    <label className="form-check-label small">Active</label>
                  </div>
                  <div className="d-flex gap-2">
                    {editing && (
                      <button type="button" className="btn btn-light" onClick={() => setEditing(null)}>Cancel</button>
                    )}
                    <button className="btn btn-dark" type="submit">Save</button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}

      {products && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999 }}
          onClick={() => setProducts(null)}>
          <div className="card p-4 shadow" style={{ width: 500 }} onClick={(e) => e.stopPropagation()}>
            <h5>Top Products — {products.territory}</h5>
            {!products.products.length ? (
              <p className="text-muted mb-0">No product data for this territory.</p>
            ) : (
              <table className="table table-sm mb-0">
                <thead><tr><th>Product</th><th>Qty</th><th>Revenue</th></tr></thead>
                <tbody>
                  {products.products.map((p, i) => (
                    <tr key={i}>
                      <td>{p.product_name}</td><td>{p.total_qty}</td><td>{fmt(p.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <button className="btn btn-secondary mt-3" onClick={() => setProducts(null)}>Close</button>
          </div>
        </div>
      )}
      <ConfirmModal
        open={deleteId !== null}
        title="Delete territory?"
        message="This will permanently remove this territory. This action cannot be undone."
        confirmLabel="Delete"
        danger
        onConfirm={remove}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
