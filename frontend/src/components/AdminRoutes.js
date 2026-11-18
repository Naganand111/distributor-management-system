import React, { useCallback, useEffect, useState } from "react";
import { FiMap, FiPlus, FiRefreshCw } from "react-icons/fi";
import api from "../lib/api";
import { formatDateOnly } from "../lib/utils";
import { Skeleton, EmptyState, ConfirmModal, useToast, StatusBadge, PageHeader } from "./ui";

const EMPTY_FORM = {
  id: null,
  sales_rep_id: "",
  route_date: "",
  notes: "",
  status: "active",
  stops: [],
};

export default function AdminRoutes() {
  const [routes, setRoutes] = useState([]);
  const [reps, setReps] = useState([]);
  const [retailers, setRetailers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [showModal, setShowModal] = useState(false);
  const [cancelId, setCancelId] = useState(null);
  const [filterRep, setFilterRep] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterDate, setFilterDate] = useState("");
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (filterRep) params.set("sales_rep_id", filterRep);
      if (filterDate) params.set("date", filterDate);
      if (filterStatus) params.set("status", filterStatus);
      const res = await api.get(`/sales-routes?${params.toString()}`);
      setRoutes(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to load sales routes");
    } finally {
      setLoading(false);
    }
  }, [filterRep, filterDate, filterStatus]);

  const loadOptions = useCallback(async () => {
    try {
      const [repRes, retailRes] = await Promise.all([
        api.get("/sales-representatives"),
        api.get("/dms/retailers"),
      ]);
      setReps(Array.isArray(repRes.data) ? repRes.data : []);
      setRetailers(Array.isArray(retailRes.data) ? retailRes.data : []);
    } catch (err) {
      console.error("Load route options error:", err);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadOptions();
  }, [loadOptions]);

  const openCreate = () => {
    setForm({ ...EMPTY_FORM, stops: [{ retailer_id: "", stop_order: 1 }] });
    setShowModal(true);
  };

  const openEdit = (r) => {
    setForm({
      id: r.id,
      sales_rep_id: String(r.sales_rep_id || ""),
      route_date: r.route_date ? String(r.route_date).slice(0, 10) : "",
      notes: r.notes || "",
      status: r.status || "active",
      stops: [],
    });
    setShowModal(true);
  };

  const setStop = (index, value) => {
    const stops = form.stops.map((s, i) =>
      i === index ? { ...s, retailer_id: value } : s
    );
    setForm({ ...form, stops });
  };

  const removeStop = (index) => {
    const stops = form.stops.filter((_, i) => i !== index);
    setForm({ ...form, stops });
  };

  const addStop = () => {
    setForm({ ...form, stops: [...form.stops, { retailer_id: "", stop_order: form.stops.length + 1 }] });
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (form.id) {
        await api.put(`/sales-routes/${form.id}`, {
          notes: form.notes,
          status: form.status,
        });
        toast.success("Route updated");
      } else {
        const stops = form.stops
          .filter((s) => s.retailer_id)
          .map((s, i) => ({ retailer_id: Number(s.retailer_id), stop_order: i + 1 }));
        if (!form.sales_rep_id) {
          toast.error("Sales rep is required");
          return;
        }
        if (!form.route_date) {
          toast.error("Route date is required");
          return;
        }
        if (!stops.length) {
          toast.error("At least one stop is required");
          return;
        }
        await api.post("/sales-routes", {
          sales_rep_id: Number(form.sales_rep_id),
          route_date: form.route_date,
          notes: form.notes || null,
          stops,
        });
        toast.success("Route created");
      }
      setShowModal(false);
      setForm(EMPTY_FORM);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to save route");
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (r) => {
    const next = r.status === "active" ? "inactive" : "active";
    try {
      await api.put(`/sales-routes/${r.id}`, { status: next });
      toast.success(`Route marked ${next}`);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to update route");
    }
  };

  const cancel = async () => {
    try {
      await api.delete(`/sales-routes/${cancelId}`);
      toast.success("Route cancelled");
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to cancel route");
    } finally {
      setCancelId(null);
    }
  };

  const repName = (r) => r.sales_rep_name ||
    reps.find((x) => String(x.id) === String(r.sales_rep_id))?.name ||
    `#${r.sales_rep_id}`;

  return (
    <div className="container-fluid py-4">
      <PageHeader
        title="Sales Routes"
        subtitle="Plan and manage field sales routes and their stops."
        actions={
          <div className="d-flex gap-2">
            <button className="btn btn-outline-secondary" onClick={() => { load(); loadOptions(); }}>
              <FiRefreshCw className="me-1" />Refresh
            </button>
            <button className="btn btn-dark" onClick={openCreate}>
              <FiPlus className="me-1" />New Route
            </button>
          </div>
        }
      />

      {error && <div className="alert alert-danger">{error}</div>}

      <div className="card p-3 mb-3">
        <div className="row g-2">
          <div className="col-md-4">
            <select className="form-select" value={filterRep} onChange={(e) => setFilterRep(e.target.value)}>
              <option value="">All Sales Reps</option>
              {reps.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>
          <div className="col-md-3">
            <input className="form-control" type="date" value={filterDate}
              onChange={(e) => setFilterDate(e.target.value)} aria-label="Route date" />
          </div>
          <div className="col-md-3">
            <select className="form-select" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
              <option value="">All Statuses</option>
              {["active", "inactive", "planned", "in_progress", "completed", "cancelled"].map((s) => (
                <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
              ))}
            </select>
          </div>
          <div className="col-md-2 text-end">
            <button className="btn btn-sm btn-outline-secondary" onClick={() => {
              setFilterRep(""); setFilterDate(""); setFilterStatus("");
            }}>
              Clear
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <Skeleton type="card" rows={6} />
      ) : routes.length === 0 ? (
        <EmptyState icon={<FiMap size={28} />} title="No sales routes found"
          sub="Plan your first route to assign stops to a sales rep." />
      ) : (
        <div className="card shadow-sm">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>Route Code</th>
                  <th>Sales Rep</th>
                  <th>Date</th>
                  <th>Stops</th>
                  <th>Notes</th>
                  <th>Status</th>
                  <th className="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                {routes.map((r) => (
                  <tr key={r.id}>
                    <td className="fw-semibold">{r.route_code || `#${r.id}`}</td>
                    <td>{repName(r)}</td>
                    <td className="small text-muted">{formatDateOnly(r.route_date)}</td>
                    <td>
                      <span className="badge bg-secondary">
                        {r.total_stops ?? 0} total
                      </span>{" "}
                      <span className="badge bg-success">
                        {r.completed_stops ?? 0} done
                      </span>
                    </td>
                    <td className="text-muted small">{r.notes || "—"}</td>
                    <td><StatusBadge status={r.status} /></td>
                    <td className="text-end">
                      <button className="btn btn-sm btn-light me-1" onClick={() => openEdit(r)}>
                        Edit
                      </button>
                      <button className="btn btn-sm btn-outline-secondary me-1"
                        disabled={r.status === "cancelled"} onClick={() => toggleStatus(r)}>
                        {r.status === "active" ? "Deactivate" : "Activate"}
                      </button>
                      <button className="btn btn-sm btn-outline-danger"
                        disabled={r.status === "cancelled"} onClick={() => setCancelId(r.id)}>
                        Cancel
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showModal && (
        <div className="modal show d-block" tabIndex="-1" style={{ background: "rgba(0,0,0,.5)" }}
          onClick={() => setShowModal(false)}>
          <div className="modal-dialog modal-lg modal-dialog-centered"
            onClick={(e) => e.stopPropagation()}>
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">{form.id ? "Edit Route" : "New Route"}</h5>
                <button type="button" className="btn-close" onClick={() => setShowModal(false)} />
              </div>
              <form onSubmit={save}>
                <div className="modal-body">
                  <div className="row g-3">
                    <div className="col-md-6">
                      <label className="form-label small">Sales Rep *</label>
                      <select className="form-select" value={form.sales_rep_id}
                        onChange={(e) => setForm({ ...form, sales_rep_id: e.target.value })}>
                        <option value="">— Select sales rep —</option>
                        {reps.map((r) => (
                          <option key={r.id} value={r.id}>{r.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="col-md-6">
                      <label className="form-label small">Route Date *</label>
                      <input className="form-control" type="date" value={form.route_date}
                        onChange={(e) => setForm({ ...form, route_date: e.target.value })} />
                    </div>
                    <div className="col-12">
                      <label className="form-label small">Notes</label>
                      <textarea className="form-control" rows="2" value={form.notes}
                        onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                    </div>
                    {!form.id && (
                      <div className="col-12">
                        <label className="form-label small">Stops (retailers) *</label>
                        {form.stops.map((s, i) => (
                          <div className="row g-2 align-items-center mb-2" key={i}>
                            <div className="col-1 text-muted small">{i + 1}.</div>
                            <div className="col-8">
                              <select className="form-select" value={s.retailer_id}
                                onChange={(e) => setStop(i, e.target.value)}>
                                <option value="">— Select retailer —</option>
                                {retailers.map((rt) => (
                                  <option key={rt.id} value={rt.id}>
                                    {rt.shop_name || rt.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="col-3">
                              <button type="button" className="btn btn-sm btn-outline-danger"
                                disabled={form.stops.length <= 1} onClick={() => removeStop(i)}>
                                Remove
                              </button>
                            </div>
                          </div>
                        ))}
                        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={addStop}>
                          + Add Stop
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-light" onClick={() => setShowModal(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-dark" disabled={saving}>
                    {saving ? "Saving…" : form.id ? "Update" : "Create Route"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={cancelId !== null}
        title="Cancel route?"
        message="This will mark the route and its pending stops as cancelled. This action cannot be undone."
        confirmLabel="Cancel Route"
        danger
        onConfirm={cancel}
        onCancel={() => setCancelId(null)}
      />
    </div>
  );
}