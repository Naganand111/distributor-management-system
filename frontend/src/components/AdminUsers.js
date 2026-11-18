import React, { useCallback, useEffect, useState } from "react";
import api from "../lib/api";
import { formatINR, formatDate } from "../lib/utils";
import { useToast } from "./ui";

export default function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "customer",
  });
  const [selected, setSelected] = useState(null);
  const [details, setDetails] = useState(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const toast = useToast();

  const loadUsers = useCallback(async () => {
    try {
      const res = await api.get("/users");
      setUsers(Array.isArray(res.data?.data) ? res.data.data : []);
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to load customers");
    }
  }, [toast]);

  const deleteUser = async (u) => {
    if (!window.confirm(`Delete customer "${u.name}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/users/${u.id}`);
      toast.success("Customer deleted");
      if (selected?.id === u.id) { setSelected(null); setDetails(null); }
      loadUsers();
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to delete customer");
    }
  };

  const addUser = async (e) => {
    e.preventDefault();
    try {
      await api.post("/users", form);
      setForm({ name: "", email: "", password: "", role: "customer" });
      toast.success("Customer added successfully");
      loadUsers();
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to add customer");
    }
  };

  const showDetails = async (u) => {
    setSelected(u);
    setDetails(null);
    setLoadingDetails(true);
    try {
      const res = await api.get(`/users/${u.id}/overview`);
      setDetails(res.data?.data || null);
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to load customer details");
    } finally {
      setLoadingDetails(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const filtered = users.filter(
    (u) =>
      u.name?.toLowerCase().includes(search.toLowerCase()) ||
      u.email?.toLowerCase().includes(search.toLowerCase()) ||
      String(u.mobile || "").includes(search)
  );

  const totalLTV = users.reduce((s, u) => s + Number(u.total_spent || 0), 0);

  return (
    <div>
      <div className="d-flex flex-wrap justify-content-between align-items-center gap-3 mb-3">
        <div>
          <h2 className="mb-1">Manage Customers</h2>
          <div className="text-muted small">
            {users.length} customers · Lifetime value {formatINR(totalLTV)}
          </div>
        </div>
        <input
          type="text"
          className="form-control"
          style={{ maxWidth: 300 }}
          placeholder="Search by name / email / mobile"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Add User Form */}
      <form onSubmit={addUser} className="mb-3 p-3 card shadow-sm">
        <div className="row g-2">
          <div className="col-md-3">
            <input type="text" placeholder="Name" className="form-control"
              value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div className="col-md-3">
            <input type="email" placeholder="Email" className="form-control"
              value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          </div>
          <div className="col-md-3">
            <input type="password" placeholder="Password" className="form-control"
              value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
          </div>
          <div className="col-md-3">
            <div className="d-flex gap-2">
              <select className="form-select" value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="customer">Customer</option>
                <option value="admin">Admin</option>
              </select>
              <button type="submit" className="btn btn-primary text-nowrap">Add User</button>
            </div>
          </div>
        </div>
      </form>

      {/* Customer Table */}
      <div className="card shadow-sm">
        <div className="table-responsive">
          <table className="table table-hover align-middle mb-0">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Contact</th>
                <th>Orders</th>
                <th>Total Spent</th>
                <th>Last Order</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-4 text-muted">No customers found</td>
                </tr>
              ) : (
                filtered.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div className="fw-semibold">{u.name}</div>
                      <div className="small text-muted">{u.email}</div>
                    </td>
                    <td>{u.mobile || "—"}</td>
                    <td>
                      <span className="fw-semibold">{u.orders_count || 0}</span>
                      <span className="small text-muted"> ({u.active_orders_count || 0} active)</span>
                    </td>
                    <td className="fw-semibold text-success">{formatINR(u.total_spent)}</td>
                    <td className="small text-muted">{u.last_order_at ? formatDate(u.last_order_at) : "Never"}</td>
                    <td>
                      <div className="table-actions text-nowrap">
                        <button className="btn-table" onClick={() => showDetails(u)} title="View details">Details</button>
                        <button className="btn-table btn-table-danger"
                          onClick={() => deleteUser(u)} title="Delete user">Delete</button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* DETAILS MODAL */}
      {selected && (
        <div className="confirm-overlay" onClick={(e) => {
          if (e.target === e.currentTarget) { setSelected(null); setDetails(null); }
        }} role="dialog" aria-modal="true" aria-label="Customer details">
          <div className="confirm-box" style={{ maxWidth: 720, width: "92vw", maxHeight: "85vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
            <div className="confirm-icon">👤</div>
            <div className="confirm-title">{selected.name}</div>
            <div className="confirm-msg">
              <div className="small text-muted mb-1">{selected.email}{selected.mobile ? ` · ${selected.mobile}` : ""}</div>
              {(selected.address || selected.city) && (
                <div className="small text-muted mb-2">
                  {selected.address}{selected.city ? `, ${selected.city} ${selected.state || ""} ${selected.pincode || ""}` : ""}
                </div>
              )}
            </div>

            {loadingDetails ? (
              <div className="py-4 text-center text-muted">Loading customer history…</div>
            ) : !details ? (
              <div className="py-3 text-center text-muted">No details available</div>
            ) : (
              <>
                <div className="row g-2 mb-3">
                  <div className="col-md-6">
                    <div className="border rounded p-2 px-3">
                      <div className="small text-muted">Total Orders</div>
                      <div className="fw-semibold">{details.orders.length}</div>
                    </div>
                  </div>
                  <div className="col-md-6">
                    <div className="border rounded p-2 px-3">
                      <div className="small text-muted">Lifetime Spent</div>
                      <div className="fw-semibold text-success">
                        {formatINR(details.orders.reduce((s, o) => s + (Number(o.total_amount) - Number(o.discount)), 0))}
                      </div>
                    </div>
                  </div>
                </div>

                <h6 className="fw-bold">Order History</h6>
                <div className="table-responsive mb-3">
                  <table className="table table-sm table-hover align-middle mb-0">
                    <thead>
                      <tr>
                        <th>Order</th>
                        <th>Invoice</th>
                        <th>Date</th>
                        <th>Total</th>
                        <th>Status</th>
                        <th>Payment</th>
                      </tr>
                    </thead>
                    <tbody>
                      {details.orders.length === 0 ? (
                        <tr><td colSpan={6} className="text-center py-3 text-muted">No orders</td></tr>
                      ) : (
                        details.orders.map((o) => (
                          <tr key={o.id}>
                            <td>#{o.id}</td>
                            <td className="small">{o.invoice_no || "—"}</td>
                            <td className="small">{formatDate(o.created_at)}</td>
                            <td>{formatINR(Number(o.total_amount) - Number(o.discount))}</td>
                            <td><span className="text-capitalize small">{o.status}</span></td>
                            <td><span className={`badge ${String(o.payment_status) === "paid" ? "bg-success" : "bg-warning"}`}>{o.payment_status}</span></td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                <h6 className="fw-bold">Payment History</h6>
                <div className="table-responsive">
                  <table className="table table-sm align-middle mb-0">
                    <thead>
                      <tr>
                        <th>Order</th>
                        <th>Amount</th>
                        <th>Method</th>
                        <th>Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {details.payments.length === 0 ? (
                        <tr><td colSpan={4} className="text-center py-3 text-muted">No payments</td></tr>
                      ) : (
                        details.payments.map((p) => (
                          <tr key={p.id}>
                            <td>#{p.order_id}</td>
                            <td>{formatINR(p.amount)}</td>
                            <td className="text-capitalize">{p.method}</td>
                            <td className="small">{formatDate(p.payment_date || p.created_at)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            <div className="confirm-actions">
              <button className="btn btn-light" onClick={() => { setSelected(null); setDetails(null); }}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}