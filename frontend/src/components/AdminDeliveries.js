import React, { useCallback, useEffect, useState } from "react";
import api from "../lib/api";
import { formatINR } from "../lib/utils";
import { Skeleton, EmptyState, ConfirmModal, useToast } from "./ui";
import { FiTruck, FiPlus, FiPackage } from "react-icons/fi";

const STATUS_FLOW = { ready: "dispatched", dispatched: "out_for_delivery", out_for_delivery: "delivered" };
const STATUS_LABELS = { ready: "Ready", dispatched: "Dispatched", out_for_delivery: "Out for Delivery", delivered: "Delivered", failed: "Failed" };
const STATUS_COLORS = { ready: "info", dispatched: "primary", out_for_delivery: "warning", delivered: "success", failed: "danger" };

export default function AdminDeliveries() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dashboard, setDashboard] = useState(null);
  const [deliveries, setDeliveries] = useState([]);
  const [persons, setPersons] = useState([]);
  const [orders, setOrders] = useState([]);
  const [filterStatus, setFilterStatus] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [personOpen, setPersonOpen] = useState(false);
  const [failedOpen, setFailedOpen] = useState(false);
  const [failedId, setFailedId] = useState(null);
  const [failedNotes, setFailedNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ order_id: "", delivery_person: "", delivery_phone: "", vehicle_number: "", expected_delivery: "", notes: "" });
  const [personForm, setPersonForm] = useState({ name: "", phone: "", vehicle_number: "", vehicle_type: "" });
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const [deactivateId, setDeactivateId] = useState(null);
  const [deactivateName, setDeactivateName] = useState("");

  const loadDashboard = useCallback(async () => {
    try {
      const res = await api.get("/deliveries/dashboard");
      setDashboard(res.data);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to load dashboard");
    }
  }, []);

  const loadDeliveries = useCallback(async () => {
    try {
      const params = filterStatus ? { status: filterStatus } : {};
      const res = await api.get("/deliveries", { params });
      setDeliveries(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to load deliveries");
    }
  }, [filterStatus]);

  const loadPersons = useCallback(async () => {
    try {
      const res = await api.get("/deliveries/persons");
      setPersons(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error("Load persons error:", err);
    }
  }, []);

  const loadOrders = useCallback(async () => {
    try {
      const res = await api.get("/dms/sales-orders");
      setOrders(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error("Load orders error:", err);
    }
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError("");
    await Promise.all([loadDashboard(), loadDeliveries(), loadPersons(), loadOrders()]);
    setLoading(false);
  }, [loadDashboard, loadDeliveries, loadPersons, loadOrders]);

  useEffect(() => { loadAll(); }, [loadAll]);

  useEffect(() => { if (!loading) loadDeliveries(); }, [loading, loadDeliveries]);

  const advanceStatus = async (delivery) => {
    const next = STATUS_FLOW[delivery.delivery_status];
    if (!next) return;
    try {
      await api.put(`/deliveries/${delivery.id}/status`, { delivery_status: next });
      toast.success(`Status updated to ${STATUS_LABELS[next]}`);
      loadDeliveries();
      loadDashboard();
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to update status");
    }
  };

  const openFailed = (id) => { setFailedId(id); setFailedNotes(""); setFailedOpen(true); };

  const confirmFailed = async () => {
    if (!failedNotes.trim()) { toast.error("Notes are required when marking as failed"); return; }
    setSaving(true);
    try {
      await api.put(`/deliveries/${failedId}/status`, { delivery_status: "failed", notes: failedNotes.trim() });
      toast.success("Delivery marked as failed");
      setFailedOpen(false);
      loadDeliveries();
      loadDashboard();
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to update status");
    } finally {
      setSaving(false);
    }
  };

  const submitDelivery = async () => {
    if (!form.order_id) { toast.error("Order ID is required"); return; }
    setSaving(true);
    try {
      await api.post("/deliveries", { ...form, order_id: Number(form.order_id) });
      toast.success("Delivery created successfully");
      setCreateOpen(false);
      setForm({ order_id: "", delivery_person: "", delivery_phone: "", vehicle_number: "", expected_delivery: "", notes: "" });
      loadDeliveries();
      loadDashboard();
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to create delivery");
    } finally {
      setSaving(false);
    }
  };

  const submitPerson = async () => {
    if (!personForm.name.trim() || !personForm.phone.trim()) { toast.error("Name and phone are required"); return; }
    setSaving(true);
    try {
      await api.post("/deliveries/persons", personForm);
      toast.success("Delivery person added");
      setPersonOpen(false);
      setPersonForm({ name: "", phone: "", vehicle_number: "", vehicle_type: "" });
      loadPersons();
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to create delivery person");
    } finally {
      setSaving(false);
    }
  };

  const openDeactivate = (p) => {
    setDeactivateId(p.id);
    setDeactivateName(p.name);
    setDeactivateOpen(true);
  };

  const confirmDeactivate = async () => {
    try {
      await api.delete(`/deliveries/persons/${deactivateId}`);
      toast.success("Delivery person deactivated");
      setDeactivateOpen(false);
      loadPersons();
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to deactivate");
    }
  };

  const advanceLabel = (status) => {
    const map = { ready: "Dispatch", dispatched: "Out for Delivery", out_for_delivery: "Mark Delivered" };
    return map[status];
  };

  return (
    <div className="container-fluid py-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h2 className="mb-0"><FiTruck className="me-2" />Deliveries</h2>
        <div className="d-flex gap-2">
          <button className="btn btn-outline-secondary" onClick={loadAll}>Refresh</button>
          <button className="btn btn-primary" onClick={() => setCreateOpen(true)}><FiPlus className="me-1" />New Delivery</button>
        </div>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      {loading ? (
        <Skeleton type="card" rows={6} />
      ) : (
        <>
          {dashboard && (
            <div className="row g-3 mb-4">
              <div className="col-md-2 col-4">
                <div className="card p-3 shadow-sm">
                  <div className="text-muted small">Total</div>
                  <h4 className="mb-0">{dashboard.total}</h4>
                </div>
              </div>
              <div className="col-md-2 col-4">
                <div className="card p-3 shadow-sm">
                  <div className="text-muted small">Ready / Pending</div>
                  <h4 className="mb-0 text-info">{dashboard.pending}</h4>
                </div>
              </div>
              <div className="col-md-2 col-4">
                <div className="card p-3 shadow-sm">
                  <div className="text-muted small">Out for Delivery</div>
                  <h4 className="mb-0 text-warning">{dashboard.out_for_delivery}</h4>
                </div>
              </div>
              <div className="col-md-2 col-4">
                <div className="card p-3 shadow-sm">
                  <div className="text-muted small">Delivered Today</div>
                  <h4 className="mb-0 text-success">{dashboard.delivered_today}</h4>
                </div>
              </div>
              <div className="col-md-2 col-4">
                <div className="card p-3 shadow-sm">
                  <div className="text-muted small">Delivered Total</div>
                  <h4 className="mb-0 text-success">{dashboard.delivered_total}</h4>
                </div>
              </div>
              <div className="col-md-2 col-4">
                <div className="card p-3 shadow-sm">
                  <div className="text-muted small">Failed</div>
                  <h4 className="mb-0 text-danger">{dashboard.failed}</h4>
                </div>
              </div>
            </div>
          )}

          <div className="d-flex align-items-center gap-3 mb-3">
            <h5 className="mb-0">Deliveries</h5>
            <select className="form-select form-select-sm w-auto" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
              <option value="">All Statuses</option>
              {Object.entries(STATUS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>

          {deliveries.length === 0 ? (
            <div className="card"><EmptyState icon={<FiPackage />} title="No deliveries found" sub={filterStatus ? "Try a different filter." : "Create your first delivery to get started."} /></div>
          ) : (
            <div className="card shadow-sm mb-4">
              <div className="table-responsive">
                <table className="table table-striped mb-0 align-middle">
                  <thead>
                    <tr>
                      <th>Delivery #</th><th>Order</th><th>Customer</th><th>Amount</th>
                      <th>Person</th><th>Expected</th><th>Status</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {deliveries.map((d) => (
                      <tr key={d.id}>
                        <td className="fw-bold">{d.delivery_number}</td>
                        <td>#{d.order_id}</td>
                        <td>{d.customer_name || "—"}</td>
                        <td>{formatINR(d.total_amount)}</td>
                        <td className="small">{d.delivery_person || "—"}</td>
                        <td className="small">{d.expected_delivery ? new Date(d.expected_delivery).toLocaleDateString() : "—"}</td>
                        <td><span className={`badge bg-${STATUS_COLORS[d.delivery_status] || "secondary"}`}>{STATUS_LABELS[d.delivery_status] || d.delivery_status}</span></td>
                        <td className="text-end">
                          {STATUS_FLOW[d.delivery_status] && (
                            <button className="btn btn-sm btn-outline-primary me-1" onClick={() => advanceStatus(d)}>
                              {advanceLabel(d.delivery_status)}
                            </button>
                          )}
                          {d.delivery_status === "dispatched" && (
                            <button className="btn btn-sm btn-outline-danger" onClick={() => openFailed(d.id)}>
                              Mark Failed
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="d-flex align-items-center justify-content-between mb-3">
            <h5 className="mb-0">Delivery Persons</h5>
            <button className="btn btn-sm btn-outline-primary" onClick={() => setPersonOpen(true)}><FiPlus className="me-1" />Add Person</button>
          </div>

          {persons.length === 0 ? (
            <div className="card"><EmptyState title="No delivery persons" sub="Add a delivery person to assign to deliveries." /></div>
          ) : (
            <div className="card shadow-sm">
              <div className="table-responsive">
                <table className="table table-striped mb-0 align-middle">
                  <thead>
                    <tr><th>Name</th><th>Phone</th><th>Vehicle</th><th>Type</th><th></th></tr>
                  </thead>
                  <tbody>
                    {persons.map((p) => (
                      <tr key={p.id}>
                        <td className="fw-bold">{p.name}</td>
                        <td>{p.phone}</td>
                        <td>{p.vehicle_number || "—"}</td>
                        <td>{p.vehicle_type || "—"}</td>
                        <td className="text-end">
                          <button className="btn btn-sm btn-outline-danger" onClick={() => openDeactivate(p)}>Deactivate</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {createOpen && (
        <div className="confirm-overlay" onClick={() => !saving && setCreateOpen(false)} role="dialog" aria-modal="true" aria-label="Create delivery">
          <div className="confirm-box" style={{ width: 600 }} onClick={(e) => e.stopPropagation()}>
            <div className="confirm-icon"><FiTruck /></div>
            <div className="confirm-title">Create Delivery</div>
            <div className="confirm-msg text-start">
              <label className="form-label small fw-bold">Order *</label>
              <select className="form-select mb-3" value={form.order_id} disabled={saving} onChange={(e) => setForm({ ...form, order_id: e.target.value })}>
                <option value="">Select order...</option>
                {orders.map((o) => (
                  <option key={o.id} value={o.id}>#{o.id} - {o.customer_name || o.retailer_name || "Unknown"} ({formatINR(o.total_amount)})</option>
                ))}
              </select>
              <div className="row g-2 mb-3">
                <div className="col-6">
                  <label className="form-label small fw-bold">Delivery Person</label>
                  <input className="form-control" value={form.delivery_person} disabled={saving} onChange={(e) => setForm({ ...form, delivery_person: e.target.value })} />
                </div>
                <div className="col-6">
                  <label className="form-label small fw-bold">Phone</label>
                  <input className="form-control" value={form.delivery_phone} disabled={saving} onChange={(e) => setForm({ ...form, delivery_phone: e.target.value })} />
                </div>
              </div>
              <div className="row g-2 mb-3">
                <div className="col-6">
                  <label className="form-label small fw-bold">Vehicle Number</label>
                  <input className="form-control" value={form.vehicle_number} disabled={saving} onChange={(e) => setForm({ ...form, vehicle_number: e.target.value })} />
                </div>
                <div className="col-6">
                  <label className="form-label small fw-bold">Expected Delivery</label>
                  <input className="form-control" type="date" value={form.expected_delivery} disabled={saving} onChange={(e) => setForm({ ...form, expected_delivery: e.target.value })} />
                </div>
              </div>
              <label className="form-label small fw-bold">Notes</label>
              <input className="form-control" value={form.notes} disabled={saving} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            <div className="confirm-actions">
              <button className="btn btn-light" disabled={saving} onClick={() => setCreateOpen(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={saving} onClick={submitDelivery}>{saving ? "Creating..." : "Create Delivery"}</button>
            </div>
          </div>
        </div>
      )}

      {personOpen && (
        <div className="confirm-overlay" onClick={() => !saving && setPersonOpen(false)} role="dialog" aria-modal="true" aria-label="Add delivery person">
          <div className="confirm-box" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-icon"><FiPlus /></div>
            <div className="confirm-title">Add Delivery Person</div>
            <div className="confirm-msg text-start">
              <label className="form-label small fw-bold">Name *</label>
              <input className="form-control mb-3" value={personForm.name} disabled={saving} onChange={(e) => setPersonForm({ ...personForm, name: e.target.value })} />
              <label className="form-label small fw-bold">Phone *</label>
              <input className="form-control mb-3" value={personForm.phone} disabled={saving} onChange={(e) => setPersonForm({ ...personForm, phone: e.target.value })} />
              <div className="row g-2">
                <div className="col-6">
                  <label className="form-label small fw-bold">Vehicle Number</label>
                  <input className="form-control" value={personForm.vehicle_number} disabled={saving} onChange={(e) => setPersonForm({ ...personForm, vehicle_number: e.target.value })} />
                </div>
                <div className="col-6">
                  <label className="form-label small fw-bold">Vehicle Type</label>
                  <input className="form-control" value={personForm.vehicle_type} disabled={saving} onChange={(e) => setPersonForm({ ...personForm, vehicle_type: e.target.value })} />
                </div>
              </div>
            </div>
            <div className="confirm-actions">
              <button className="btn btn-light" disabled={saving} onClick={() => setPersonOpen(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={saving} onClick={submitPerson}>{saving ? "Adding..." : "Add Person"}</button>
            </div>
          </div>
        </div>
      )}

      {failedOpen && (
        <div className="confirm-overlay" onClick={() => !saving && setFailedOpen(false)} role="dialog" aria-modal="true" aria-label="Mark failed">
          <div className="confirm-box" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-title">Mark Delivery as Failed</div>
            <div className="confirm-msg text-start">
              <label className="form-label small fw-bold">Reason (required)</label>
              <textarea className="form-control" rows={3} value={failedNotes} disabled={saving} onChange={(e) => setFailedNotes(e.target.value)} placeholder="Enter reason for failure..." />
            </div>
            <div className="confirm-actions">
              <button className="btn btn-light" disabled={saving} onClick={() => setFailedOpen(false)}>Cancel</button>
              <button className="btn btn-danger" disabled={saving} onClick={confirmFailed}>{saving ? "Submitting..." : "Mark Failed"}</button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={deactivateOpen}
        title="Deactivate Delivery Person"
        message={`Are you sure you want to deactivate "${deactivateName}"? They will no longer appear in the active persons list.`}
        confirmLabel="Deactivate"
        danger
        onConfirm={confirmDeactivate}
        onCancel={() => setDeactivateOpen(false)}
      />
    </div>
  );
}
