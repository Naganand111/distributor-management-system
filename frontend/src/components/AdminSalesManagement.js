import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { useToast, ConfirmModal } from "./ui";

export default function AdminSalesManagement() {
  const [tab, setTab] = useState("reps");
  const [reps, setReps] = useState([]);
  const [territories, setTerritories] = useState([]);
  const [retailers, setRetailers] = useState([]);
  const [performance, setPerformance] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [targets, setTargets] = useState([]);
  const [commissions, setCommissions] = useState([]);
  const [loading, setLoading] = useState(true);

  const [editing, setEditing] = useState(null);
  const [deleteId, setDeleteId] = useState(null);
  const [payConfirmCount, setPayConfirmCount] = useState(0);
  const toast = useToast();
  const [form, setForm] = useState({
    name: "", email: "", phone: "", employee_code: "", territory_id: "",
    joining_date: "", target_amount: "", commission_percentage: "", status: "active",
    retailer_ids: [],
  });

  const loadAll = async () => {
    setLoading(true);
    try {
      const [r, t, rt, per, lb, tg, cm] = await Promise.all([
        api.get("/sales-representatives"),
        api.get("/territories"),
        api.get("/dms/retailers").catch(() => api.get("/retailers")),
        api.get("/sales/performance"),
        api.get("/sales/leaderboard"),
        api.get("/sales/targets"),
        api.get("/sales/commissions"),
      ]);
      setReps(Array.isArray(r.data) ? r.data : []);
      setTerritories(Array.isArray(t.data) ? t.data : []);
      setRetailers(Array.isArray(rt.data) ? rt.data : []);
      setPerformance(per.data?.performance || []);
      setLeaderboard(Array.isArray(lb.data) ? lb.data : []);
      setTargets(Array.isArray(tg.data) ? tg.data : []);
      setCommissions(Array.isArray(cm.data) ? cm.data : []);
    } catch (err) {
      console.error("Load sales error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const fillForm = (rep) => {
    setEditing(rep);
    setForm({
      name: rep.name || "", email: rep.email || "", phone: rep.phone || "",
      employee_code: rep.employee_code || "", territory_id: rep.territory_id || "",
      joining_date: rep.joining_date || "",
      target_amount: rep.target_amount || "", commission_percentage: rep.commission_percentage || "",
      status: rep.status || "active",
      retailer_ids: rep.retailer_ids || [],
    });
  };

  const submitRep = async (e) => {
    e.preventDefault();
    try {
      if (editing) {
        await api.put(`/sales-representatives/${editing.id}`, form);
      } else {
        await api.post("/sales-representatives", form);
      }
      setEditing(null);
      setForm({
        name: "", email: "", phone: "", employee_code: "", territory_id: "",
        joining_date: "", target_amount: "", commission_percentage: "", status: "active",
        retailer_ids: [],
      });
      loadAll();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to save");
    }
  };

  const removeRep = async () => {
    try {
      await api.delete(`/sales-representatives/${deleteId}`);
      toast.success("Sales representative deleted");
      loadAll();
    } catch (err) {
      toast.error(err.response?.data?.error || "Delete failed");
    } finally {
      setDeleteId(null);
    }
  };

  const [targetForm, setTargetForm] = useState({
    sales_rep_id: "", period: "", target_amount: "",
  });
  const submitTarget = async (e) => {
    e.preventDefault();
    try {
      await api.post("/sales/targets", targetForm);
      setTargetForm({ sales_rep_id: "", period: "", target_amount: "" });
      loadAll();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to set target");
    }
  };

  const payCommissions = async () => {
    const ids = commissions.filter((c) => c.status === "accrued").map((c) => c.id);
    if (!ids.length) return toast.warning("No unpaid commissions");
    setPayConfirmCount(ids.length);
  };

  const confirmPayCommissions = async () => {
    const ids = commissions.filter((c) => c.status === "accrued").map((c) => c.id);
    try {
      await api.post("/sales/commissions/pay", { ids });
      toast.success("Commissions marked as paid");
      loadAll();
    } catch (err) {
      toast.error(err.response?.data?.error || "Payment failed");
    } finally {
      setPayConfirmCount(0);
    }
  };

  const month = new Date().toISOString().slice(0, 7);
  const fmt = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

  const tabs = [
    ["reps", "Representatives"],
    ["performance", "Performance"],
    ["leaderboard", "Leaderboard"],
    ["targets", "Targets"],
    ["commissions", "Commissions"],
  ];

  return (
    <div className="container-fluid py-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h2 className="mb-0">Sales & Distribution</h2>
        <button className="btn btn-outline-secondary" onClick={loadAll}>
          Refresh
        </button>
      </div>

      <ul className="nav nav-pills mb-4">
        {tabs.map(([key, label]) => (
          <li className="nav-item" key={key}>
            <button
              className={`nav-link ${tab === key ? "active" : ""}`}
              style={tab === key ? { background: "var(--brand)" } : {}}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          </li>
        ))}
      </ul>

      {loading ? (
        <div className="loading">Loading...</div>
      ) : (
        <>
          {tab === "reps" && (
            <div className="row">
              <div className="col-md-7">
                <div className="card shadow-sm">
                  <div className="card-header bg-white d-flex justify-content-between align-items-center">
                    <span className="fw-semibold">Sales Representatives</span>
                    <button
                      className="btn btn-sm btn-dark"
                      onClick={() => {
                        setEditing(null);
                        setForm({
                          name: "", email: "", phone: "", employee_code: "", territory_id: "",
                          joining_date: "", target_amount: "", commission_percentage: "",
                          status: "active", retailer_ids: [],
                        });
                      }}
                    >
                      + New
                    </button>
                  </div>
                  <div className="table-responsive">
                    <table className="table table-striped mb-0 align-middle">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Code</th>
                          <th>Territory</th>
                          <th>Target</th>
                          <th>Comm%</th>
                          <th>Retailers</th>
                          <th>Status</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {reps.map((r) => (
                          <tr key={r.id}>
                            <td>
                              <div>{r.name}</div>
                              <div className="small text-muted">{r.email}</div>
                            </td>
                            <td>{r.employee_code || "—"}</td>
                            <td>{r.territory_name || "—"}</td>
                            <td>{fmt(r.target_amount)}</td>
                            <td>{r.commission_percentage}%</td>
                            <td>{r.retailer_count || 0}</td>
                            <td>
                              <span className={`status ${r.status}`}>{r.status}</span>
                            </td>
                            <td className="text-end">
                              <button className="btn btn-sm btn-outline-primary me-1" onClick={() => fillForm(r)}>
                                Edit
                              </button>
                              <button className="btn btn-sm btn-outline-danger" onClick={() => setDeleteId(r.id)}>
                                Del
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div className="col-md-5">
                <div className="card shadow-sm">
                  <div className="card-header bg-white fw-semibold">
                    {editing ? `Edit: ${editing.name}` : "Add Sales Representative"}
                  </div>
                  <div className="card-body">
                    <form onSubmit={submitRep}>
                      <label className="small">Name *</label>
                      <input className="form-control mb-2" required value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })} />
                      <div className="row">
                        <div className="col-6">
                          <label className="small">Employee Code</label>
                          <input className="form-control mb-2" value={form.employee_code}
                            onChange={(e) => setForm({ ...form, employee_code: e.target.value })} />
                        </div>
                        <div className="col-6">
                          <label className="small">Phone</label>
                          <input className="form-control mb-2" value={form.phone}
                            onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                        </div>
                      </div>
                      <label className="small">Email</label>
                      <input className="form-control mb-2" type="email" value={form.email}
                        onChange={(e) => setForm({ ...form, email: e.target.value })} />
                      <label className="small">Territory</label>
                      <select className="form-select mb-2" value={form.territory_id}
                        onChange={(e) => setForm({ ...form, territory_id: e.target.value })}>
                        <option value="">— None —</option>
                        {territories.map((t) => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </select>
                      <div className="row">
                        <div className="col-4">
                          <label className="small">Joining Date</label>
                          <input className="form-control mb-2" type="date" value={form.joining_date}
                            onChange={(e) => setForm({ ...form, joining_date: e.target.value })} />
                        </div>
                        <div className="col-4">
                          <label className="small">Target (₹)</label>
                          <input className="form-control mb-2" type="number" value={form.target_amount}
                            onChange={(e) => setForm({ ...form, target_amount: e.target.value })} />
                        </div>
                        <div className="col-4">
                          <label className="small">Comm %</label>
                          <input className="form-control mb-2" type="number" value={form.commission_percentage}
                            onChange={(e) => setForm({ ...form, commission_percentage: e.target.value })} />
                        </div>
                      </div>
                      <label className="small">Assigned Retailers</label>
                      <select multiple className="form-select mb-2" style={{ height: 100 }}
                        value={form.retailer_ids.map(String)}
                        onChange={(e) => setForm({
                          ...form,
                          retailer_ids: Array.from(e.target.selectedOptions).map((o) => o.value),
                        })}>
                        {retailers.map((r) => (
                          <option key={r.id} value={r.id}>{r.shop_name || r.name}</option>
                        ))}
                      </select>
                      <div className="form-check mb-3">
                        <input className="form-check-input" type="checkbox"
                          checked={form.status === "active"}
                          onChange={(e) => setForm({ ...form, status: e.target.checked ? "active" : "inactive" })} />
                        <label className="form-check-label small">Active</label>
                      </div>
                      <div className="d-flex gap-2">
                        {editing && (
                          <button type="button" className="btn btn-light"
                            onClick={() => { setEditing(null); }}>
                            Cancel
                          </button>
                        )}
                        <button className="btn btn-dark" type="submit">Save</button>
                      </div>
                    </form>
                  </div>
                </div>
              </div>
            </div>
          )}

          {tab === "performance" && (
            <div className="card shadow-sm">
              <div className="card-header bg-white fw-semibold">
                Performance — {month}
              </div>
              <div className="table-responsive">
                <table className="table table-striped mb-0 align-middle">
                  <thead>
                    <tr>
                      <th>Rep</th>
                      <th>Orders</th>
                      <th>Sales</th>
                      <th>Collected</th>
                      <th>Pending</th>
                      <th>Target</th>
                      <th>Achievement</th>
                      <th>Commission</th>
                    </tr>
                  </thead>
                  <tbody>
                    {performance.map((p) => (
                      <tr key={p.sales_rep_id}>
                        <td>{p.sales_rep_name}</td>
                        <td>{p.orders_count}</td>
                        <td>{fmt(p.total_sales)}</td>
                        <td>{fmt(p.collected)}</td>
                        <td>{fmt(p.pending)}</td>
                        <td>{fmt(p.target_amount)}</td>
                        <td>
                          <div className="d-flex align-items-center gap-2">
                            <div className="progress flex-grow-1" style={{ height: 8 }}>
                              <div className="progress-bar" style={{
                                width: `${Math.min(p.achievement_pct, 100)}%`,
                                background: p.achievement_pct >= 100 ? "#28a745" : "#ffc107",
                              }} />
                            </div>
                            <span className="small">{p.achievement_pct}%</span>
                          </div>
                        </td>
                        <td>{fmt(p.commission_earned)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === "leaderboard" && (
            <div className="card shadow-sm">
              <div className="card-header bg-white fw-semibold">Leaderboard — this month</div>
              <div className="table-responsive">
                <table className="table table-striped mb-0">
                  <thead>
                    <tr><th>#</th><th>Rep</th><th>Orders</th><th>Sales</th><th>Target</th></tr>
                  </thead>
                  <tbody>
                    {leaderboard.map((l, i) => (
                      <tr key={l.id}>
                        <td>
                          <span className="badge bg-dark">{i + 1}</span>
                        </td>
                        <td>{l.name}</td>
                        <td>{l.orders_count}</td>
                        <td>{fmt(l.total_sales)}</td>
                        <td>{fmt(l.target_amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === "targets" && (
            <div className="row">
              <div className="col-md-8">
                <div className="card shadow-sm">
                  <div className="card-header bg-white fw-semibold">Monthly Targets</div>
                  <div className="table-responsive">
                    <table className="table table-striped mb-0 align-middle">
                      <thead>
                        <tr><th>Period</th><th>Rep</th><th>Target</th><th>Achieved</th><th>%</th></tr>
                      </thead>
                      <tbody>
                        {targets.map((t) => (
                          <tr key={t.id}>
                            <td>{t.period}</td>
                            <td>{t.sales_rep_name}</td>
                            <td>{fmt(t.target_amount)}</td>
                            <td>{fmt(t.achieved_amount)}</td>
                            <td><span className={`status ${t.achievement_pct >= 100 ? "active" : "pending"}`}>
                              {t.achievement_pct}%
                            </span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
              <div className="col-md-4">
                <div className="card shadow-sm">
                  <div className="card-header bg-white fw-semibold">Set Target</div>
                  <div className="card-body">
                    <form onSubmit={submitTarget}>
                      <label className="small">Sales Rep</label>
                      <select className="form-select mb-2" required value={targetForm.sales_rep_id}
                        onChange={(e) => setTargetForm({ ...targetForm, sales_rep_id: e.target.value })}>
                        <option value="">— Select —</option>
                        {reps.map((r) => (
                          <option key={r.id} value={r.id}>{r.name}</option>
                        ))}
                      </select>
                      <label className="small">Period (YYYY-MM)</label>
                      <input className="form-control mb-2" required type="month" value={targetForm.period}
                        onChange={(e) => setTargetForm({ ...targetForm, period: e.target.value })} />
                      <label className="small">Target Amount (₹)</label>
                      <input className="form-control mb-3" required type="number" value={targetForm.target_amount}
                        onChange={(e) => setTargetForm({ ...targetForm, target_amount: e.target.value })} />
                      <button className="btn btn-dark w-100">Save Target</button>
                    </form>
                  </div>
                </div>
              </div>
            </div>
          )}

          {tab === "commissions" && (
            <div className="card shadow-sm">
              <div className="card-header bg-white d-flex justify-content-between align-items-center">
                <span className="fw-semibold">Commissions</span>
                <button className="btn btn-sm btn-dark" onClick={payCommissions}>
                  Mark Paid
                </button>
              </div>
              <div className="table-responsive">
                <table className="table table-striped mb-0">
                  <thead>
                    <tr><th>Rep</th><th>Amount</th><th>Period</th><th>Status</th></tr>
                  </thead>
                  <tbody>
                    {commissions.map((c) => (
                      <tr key={c.id}>
                        <td>{c.sales_rep_name}</td>
                        <td>{fmt(c.amount)}</td>
                        <td>{c.period || "—"}</td>
                        <td><span className={`status ${c.status}`}>{c.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!commissions.length && (
                  <p className="p-3 text-muted">
                    No commissions yet. Commissions are accrued when sales performance is calculated
                    against active reps.
                  </p>
                )}
              </div>
            </div>
          )}
        </>
      )}

      <ConfirmModal
        open={deleteId !== null}
        title="Delete sales representative?"
        message="This will permanently remove this sales representative. This action cannot be undone."
        confirmLabel="Delete"
        danger
        onConfirm={removeRep}
        onCancel={() => setDeleteId(null)}
      />

      <ConfirmModal
        open={payConfirmCount > 0}
        title={`Mark ${payConfirmCount} commissions as paid?`}
        message="This action will mark the selected commissions as paid."
        confirmLabel="Mark Paid"
        danger
        onConfirm={confirmPayCommissions}
        onCancel={() => setPayConfirmCount(0)}
      />
    </div>
  );
}
