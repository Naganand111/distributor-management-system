import React, { useCallback, useEffect, useState } from "react";
import api from "../lib/api";
import { formatDate } from "../lib/utils";

export default function AdminActivityLogs() {
  const [logs, setLogs] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 1 });
  const [filters, setFilters] = useState({ action: "", module: "", search: "", from: "", to: "" });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("limit", "50");
      params.set("page", String(page));
      if (filters.action) params.set("action", filters.action);
      if (filters.module) params.set("module", filters.module);
      if (filters.search) params.set("search", filters.search);
      if (filters.from) params.set("from", filters.from);
      if (filters.to) params.set("to", filters.to);
      const res = await api.get(`/activity-logs?${params.toString()}`);
      setLogs(Array.isArray(res.data.data) ? res.data.data : []);
      if (res.data.pagination) setPagination(res.data.pagination);
    } catch (err) {
      console.error("Load activity logs:", err);
    } finally {
      setLoading(false);
    }
  }, [page, filters]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    setPage(1);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.action, filters.module, filters.search, filters.from, filters.to]);

  const badge = (action) => {
    const map = { LOGIN: "bg-secondary", CREATE: "bg-success", UPDATE: "bg-primary", DELETE: "bg-danger", PAYMENT: "bg-info text-dark", ORDER: "bg-dark" };
    return `badge ${map[action] || "bg-secondary"}`;
  };

  return (
    <div className="container-fluid py-4">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h2 className="mb-0">Activity Logs</h2>
        <button className="btn btn-outline-secondary" onClick={() => { setPage(1); load(); }}>Refresh</button>
      </div>

      <div className="row g-2 mb-3">
        <div className="col-md-3">
          <input className="form-control" placeholder="Search text / user"
            value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} />
        </div>
        <div className="col-md-2">
          <select className="form-select" value={filters.action} onChange={(e) => setFilters({ ...filters, action: e.target.value })}>
            <option value="">All Actions</option>
            {["LOGIN", "CREATE", "UPDATE", "DELETE", "PAYMENT", "ORDER"].map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div className="col-md-2">
          <select className="form-select" value={filters.module} onChange={(e) => setFilters({ ...filters, module: e.target.value })}>
            <option value="">All Modules</option>
            {["AUTH", "ORDER", "PAYMENT", "RETURN", "PRODUCT", "CUSTOMER", "USER"].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div className="col-md-2">
          <input className="form-control" type="date" value={filters.from}
            onChange={(e) => setFilters({ ...filters, from: e.target.value })}
            aria-label="From date" placeholder="From" />
        </div>
        <div className="col-md-2">
          <input className="form-control" type="date" value={filters.to}
            onChange={(e) => setFilters({ ...filters, to: e.target.value })}
            aria-label="To date" placeholder="To" />
        </div>
        <div className="col-md-1 text-end d-flex align-items-center justify-content-end">
          <span className="text-muted small">{pagination.total} entries</span>
        </div>
        <div className="col-md-12 d-flex justify-content-end">
          <button className="btn btn-sm btn-outline-secondary me-2" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>
          <span className="me-2">Page {page}/{pagination.totalPages || 1}</span>
          <button className="btn btn-sm btn-outline-secondary" disabled={page >= (pagination.totalPages || 1)} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      </div>

      {loading ? (
        <div className="loading">Loading...</div>
      ) : (
        <div className="card shadow-sm">
          <div className="table-responsive">
            <table className="table table-striped mb-0 align-middle">
              <thead>
                <tr><th>#</th><th>User</th><th>Action</th><th>Module</th><th>Description</th><th>Date</th></tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td>{l.id}</td>
                    <td>{l.user_name}</td>
                    <td><span className={badge(l.action)}>{l.action}</span></td>
                    <td>{l.module}</td>
                    <td>{l.description || "—"}</td>
                    <td>{formatDate(l.created_at)}</td>
                  </tr>
                ))}
                {!logs.length && <tr><td colSpan="6" className="text-muted p-3">No activity logs found.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
