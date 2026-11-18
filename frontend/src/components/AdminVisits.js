import React, { useCallback, useEffect, useState } from "react";
import { FiLogIn, FiRefreshCw } from "react-icons/fi";
import api from "../lib/api";
import { formatINR, formatDate } from "../lib/utils";
import { Skeleton, EmptyState, useToast, StatusBadge, PageHeader } from "./ui";

const EMPTY_FORM = {
  retailer_id: "",
  sales_rep_id: "",
  notes: "",
};

export default function AdminVisits() {
  const [visits, setVisits] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [reps, setReps] = useState([]);
  const [retailers, setRetailers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [status, setStatus] = useState("");
  const [repId, setRepId] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [showLogModal, setShowLogModal] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (repId) params.set("sales_rep_id", repId);
      if (status) params.set("status", status);
      if (from) params.set("date", from);
      const [listRes, dashRes] = await Promise.all([
        api.get(`/visits?${params.toString()}`),
        api.get("/visits/dashboard"),
      ]);
      setVisits(Array.isArray(listRes.data) ? listRes.data : []);
      setDashboard(dashRes.data || null);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to load visits");
    } finally {
      setLoading(false);
    }
  }, [repId, status, from]);

  const loadOptions = useCallback(async () => {
    try {
      const [repRes, retailRes] = await Promise.all([
        api.get("/sales-representatives"),
        api.get("/dms/retailers"),
      ]);
      setReps(Array.isArray(repRes.data) ? repRes.data : []);
      setRetailers(Array.isArray(retailRes.data) ? retailRes.data : []);
    } catch (err) {
      console.error("Load visit options error:", err);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadOptions();
  }, [loadOptions]);

  const filtered = visits.filter((v) => {
    if (to) {
      const d = String(v.visit_date || "").slice(0, 10);
      if (d && d > to) return false;
    }
    return true;
  });

  const today = new Date().toISOString().slice(0, 10);
  const skippedToday = filtered.filter((v) => v.status === "skipped" && String(v.visit_date).slice(0, 10) === today).length;

  const logVisit = async (e) => {
    e.preventDefault();
    if (!form.retailer_id || !form.sales_rep_id) {
      toast.error("Retailer and sales rep are required");
      return;
    }
    setSaving(true);
    try {
      await api.post("/visits/check-in", {
        retailer_id: Number(form.retailer_id),
        sales_rep_id: Number(form.sales_rep_id),
        route_id: null,
        route_stop_id: null,
        notes: form.notes || null,
      });
      toast.success("Visit checked in");
      setShowLogModal(false);
      setForm(EMPTY_FORM);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to log visit");
    } finally {
      setSaving(false);
    }
  };

  const repDisplay = (v) => v.sales_rep_name ||
    reps.find((x) => String(x.id) === String(v.sales_rep_id))?.name ||
    `#${v.sales_rep_id}`;

  const retailerDisplay = (v) => v.retailer_name ||
    retailers.find((x) => String(x.id) === String(v.retailer_id))?.name ||
    `#${v.retailer_id}`;

  return (
    <div className="container-fluid py-4">
      <PageHeader
        title="Retailer Visits"
        subtitle="Track sales rep check-ins, check-outs and visit outcomes."
        actions={
          <div className="d-flex gap-2">
            <button className="btn btn-outline-secondary" onClick={load}>
              <FiRefreshCw className="me-1" />Refresh
            </button>
            <button className="btn btn-dark" onClick={() => setShowLogModal(true)}>
              <FiLogIn className="me-1" />Log Visit
            </button>
          </div>
        }
      />

      {error && <div className="alert alert-danger">{error}</div>}

      <div className="row g-3 mb-4">
        <div className="col-md-3">
          <div className="card p-3">
            <div className="text-muted small">Visits Today</div>
            <h3 className="mb-0">{dashboard?.today?.total ?? "—"}</h3>
            <div className="text-muted small">completed: {dashboard?.today?.completed ?? 0}</div>
          </div>
        </div>
        <div className="col-md-3">
          <div className="card p-3">
            <div className="text-muted small">Week Sales</div>
            <h3 className="mb-0">{dashboard ? formatINR(dashboard.thisWeek?.total_sales) : "—"}</h3>
            <div className="text-muted small">{dashboard?.thisWeek?.total ?? 0} visits (7d)</div>
          </div>
        </div>
        <div className="col-md-3">
          <div className="card p-3">
            <div className="text-muted small">Avg Visit Duration</div>
            <h3 className="mb-0">
              {dashboard?.thisWeek?.avg_duration != null
                ? `${Number(dashboard.thisWeek.avg_duration).toFixed(0)} min`
                : "—"}
            </h3>
            <div className="text-muted small">last 7 days</div>
          </div>
        </div>
        <div className="col-md-3">
          <div className="card p-3">
            <div className="text-muted small">Skipped Today</div>
            <h3 className="mb-0">{skippedToday}</h3>
            <div className="text-muted small">from loaded visits</div>
          </div>
        </div>
      </div>

      <div className="card p-3 mb-3">
        <div className="row g-2">
          <div className="col-md-3">
            <input className="form-control" type="date" value={from}
              onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
          </div>
          <div className="col-md-3">
            <input className="form-control" type="date" value={to}
              onChange={(e) => setTo(e.target.value)} aria-label="To date" />
          </div>
          <div className="col-md-3">
            <select className="form-select" value={repId} onChange={(e) => setRepId(e.target.value)}>
              <option value="">All Sales Reps</option>
              {reps.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>
          <div className="col-md-3">
            <select className="form-select" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All Statuses</option>
              {["planned", "in_progress", "completed", "skipped", "cancelled"].map((s) => (
                <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {loading ? (
        <Skeleton type="card" rows={6} />
      ) : filtered.length === 0 ? (
        <EmptyState icon="🏢" title="No visits found"
          sub="Try adjusting your filters, or log a new visit." />
      ) : (
        <div className="card shadow-sm">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>Visit #</th>
                  <th>Retailer</th>
                  <th>Sales Rep</th>
                  <th>Date</th>
                  <th>Status</th>
                  <th>Sales</th>
                  <th>Duration</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((v) => (
                  <tr key={v.id}>
                    <td className="fw-semibold">{v.visit_number || `#${v.id}`}</td>
                    <td>{retailerDisplay(v)}</td>
                    <td>{repDisplay(v)}</td>
                    <td className="small text-muted">{formatDate(v.visit_date)}</td>
                    <td><StatusBadge status={v.status} /></td>
                    <td>{v.sales_amount ? formatINR(v.sales_amount) : "—"}</td>
                    <td className="small text-muted">
                      {v.duration_minutes != null ? `${v.duration_minutes} min` : "—"}
                    </td>
                    <td className="text-muted small">{v.notes || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showLogModal && (
        <div className="modal show d-block" tabIndex="-1" style={{ background: "rgba(0,0,0,.5)" }}
          onClick={() => setShowLogModal(false)}>
          <div className="modal-dialog modal-dialog-centered" onClick={(e) => e.stopPropagation()}>
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Log Visit (Check-in)</h5>
                <button type="button" className="btn-close" onClick={() => setShowLogModal(false)} />
              </div>
              <form onSubmit={logVisit}>
                <div className="modal-body">
                  <div className="row g-3">
                    <div className="col-12">
                      <label className="form-label small">Retailer *</label>
                      <select className="form-select" value={form.retailer_id}
                        onChange={(e) => setForm({ ...form, retailer_id: e.target.value })}>
                        <option value="">— Select retailer —</option>
                        {retailers.map((r) => (
                          <option key={r.id} value={r.id}>{r.shop_name || r.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="col-12">
                      <label className="form-label small">Sales Rep *</label>
                      <select className="form-select" value={form.sales_rep_id}
                        onChange={(e) => setForm({ ...form, sales_rep_id: e.target.value })}>
                        <option value="">— Select sales rep —</option>
                        {reps.map((r) => (
                          <option key={r.id} value={r.id}>{r.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="col-12">
                      <label className="form-label small">Notes</label>
                      <textarea className="form-control" rows="2" value={form.notes}
                        onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                    </div>
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-light" onClick={() => setShowLogModal(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-dark" disabled={saving}>
                    {saving ? "Saving…" : "Check In Visit"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}