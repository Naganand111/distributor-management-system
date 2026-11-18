import React, { useEffect, useState } from "react";
import { FiActivity, FiAlertTriangle, FiKey, FiRefreshCw, FiShield, FiUsers } from "react-icons/fi";
import api from "../lib/api";
import { formatDate } from "../lib/utils";
import { Skeleton, EmptyState, ConfirmModal, useToast, PageHeader } from "./ui";

const TABS = [
  ["events", "Events"],
  ["sessions", "Sessions"],
  ["passwords", "Password Changes"],
  ["audit", "Audit Log"],
];

const SEVERITY_CLASS = {
  info: "bg-info text-dark",
  warning: "bg-warning text-dark",
  critical: "bg-danger",
};

export default function AdminSecurity() {
  const [tab, setTab] = useState("events");
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingSection, setLoadingSection] = useState(false);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const toast = useToast();

  const [events, setEvents] = useState([]);
  const [eventPage, setEventPage] = useState(1);
  const [eventTotal, setEventTotal] = useState(0);
  const [eventLimit] = useState(25);
  const [evFilters, setEvFilters] = useState({ event_type: "", severity: "", search: "", from: "", to: "" });

  const [sessions, setSessions] = useState([]);
  const [revokeId, setRevokeId] = useState(null);
  const [revokeAllId, setRevokeAllId] = useState(null);

  const [passwordChanges, setPasswordChanges] = useState([]);

  const [auditLogs, setAuditLogs] = useState([]);
  const [auditFilters, setAuditFilters] = useState({ action: "", user_id: "", from: "", to: "" });

  const loadDashboard = async () => {
    try {
      const res = await api.get("/security/dashboard");
      setDashboard(res.data || null);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to load security dashboard");
    }
  };

  const loadAll = async () => {
    setRefreshing(true);
    setLoading(true);
    setError("");
    try {
      const [dash, evRes, sessRes, pwdRes, auditRes] = await Promise.all([
        api.get("/security/dashboard"),
        api.get("/security/events"),
        api.get("/security/sessions"),
        api.get("/security/password-changes"),
        api.get("/security/audit-log"),
      ]);
      setDashboard(dash.data || null);
      setEvents(Array.isArray(evRes.data.events) ? evRes.data.events : []);
      setEventTotal(evRes.data.total || 0);
      setSessions(Array.isArray(sessRes.data) ? sessRes.data : []);
      setPasswordChanges(Array.isArray(pwdRes.data) ? pwdRes.data : []);
      setAuditLogs(Array.isArray(auditRes.data) ? auditRes.data : []);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to load security data");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const loadEvents = async (page) => {
    setLoadingSection(true);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("limit", String(eventLimit));
      if (evFilters.event_type) params.set("event_type", evFilters.event_type);
      if (evFilters.severity) params.set("severity", evFilters.severity);
      if (evFilters.search) params.set("search", evFilters.search);
      if (evFilters.from) params.set("from", evFilters.from);
      if (evFilters.to) params.set("to", evFilters.to);
      const res = await api.get(`/security/events?${params.toString()}`);
      setEvents(Array.isArray(res.data.events) ? res.data.events : []);
      setEventTotal(res.data.total || 0);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to load security events");
    } finally {
      setLoadingSection(false);
    }
  };

  const loadAudit = async () => {
    setLoadingSection(true);
    try {
      const params = new URLSearchParams();
      if (auditFilters.action) params.set("action", auditFilters.action);
      if (auditFilters.user_id) params.set("user_id", auditFilters.user_id);
      if (auditFilters.from) params.set("from", auditFilters.from);
      if (auditFilters.to) params.set("to", auditFilters.to);
      const res = await api.get(`/security/audit-log?${params.toString()}`);
      setAuditLogs(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to load audit log");
    } finally {
      setLoadingSection(false);
    }
  };

  useEffect(() => {
    if (tab === "events") loadEvents(eventPage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, eventPage, evFilters.event_type, evFilters.severity, evFilters.search, evFilters.from, evFilters.to]);

  useEffect(() => {
    if (tab === "audit") loadAudit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, auditFilters.action, auditFilters.user_id, auditFilters.from, auditFilters.to]);

  useEffect(() => {
    if (tab === "sessions" || tab === "passwords") {
      setLoadingSection(true);
      const url = tab === "sessions" ? "/security/sessions" : "/security/password-changes";
      api.get(url).then((res) => {
        if (tab === "sessions") setSessions(Array.isArray(res.data) ? res.data : []);
        else setPasswordChanges(Array.isArray(res.data) ? res.data : []);
      }).catch((err) => setError(err.response?.data?.error || "Failed to load section"))
        .finally(() => setLoadingSection(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const revokeSession = async () => {
    if (!revokeId) return;
    try {
      await api.post(`/security/sessions/${revokeId}/revoke`);
      toast.success("Session revoked");
      setSessions((list) => list.filter((s) => String(s.id) !== String(revokeId)));
      loadDashboard();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to revoke session");
    } finally {
      setRevokeId(null);
    }
  };

  const revokeAll = async () => {
    if (!revokeAllId) return;
    try {
      await api.post(`/security/sessions/revoke-all/${revokeAllId}`);
      toast.success("All sessions revoked for user");
      setSessions((list) => list.filter((s) => String(s.user_id) !== String(revokeAllId)));
      loadDashboard();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to revoke sessions");
    } finally {
      setRevokeAllId(null);
    }
  };

  const eventTotalPages = Math.max(1, Math.ceil(eventTotal / eventLimit));

  return (
    <div className="container-fluid py-4">
      <PageHeader
        title="Security Center"
        subtitle="Login activity, active sessions, password resets and audit trail."
        actions={
          <button className="btn btn-outline-secondary" onClick={() => { setEventPage(1); loadAll(); }} disabled={refreshing}>
            <FiRefreshCw className="me-1" />{refreshing ? "Refreshing…" : "Refresh"}
          </button>
        }
      />

      {error && <div className="alert alert-danger">{error}</div>}

      {loading ? (
        <Skeleton type="card" rows={6} />
      ) : (
        <>
          <div className="row g-3 mb-4">
            <div className="col-md-3">
              <div className="card p-3">
                <div className="text-muted small">Logins Today</div>
                <h3 className="mb-0">{dashboard?.today?.total ?? "—"}</h3>
                <div className="small">
                  <span className="text-success">{dashboard?.today?.successful ?? 0} ok</span>
                  <span className="text-danger ms-2">{dashboard?.today?.failed ?? 0} failed</span>
                </div>
              </div>
            </div>
            <div className="col-md-3">
              <div className="card p-3">
                <div className="text-muted small">Logins This Week</div>
                <h3 className="mb-0">{dashboard?.thisWeek?.total ?? "—"}</h3>
                <div className="small">
                  <span className="text-success">{dashboard?.thisWeek?.successful ?? 0} ok</span>
                  <span className="text-danger ms-2">{dashboard?.thisWeek?.failed ?? 0} failed</span>
                </div>
              </div>
            </div>
            <div className="col-md-3">
              <div className="card p-3">
                <div className="text-muted small">Active Sessions</div>
                <h3 className="mb-0">{dashboard?.activeSessions ?? "—"}</h3>
                <div className="text-muted small">currently live sessions</div>
              </div>
            </div>
            <div className="col-md-3">
              <div className="card p-3">
                <div className="text-muted small">Suspicious IPs (1h)</div>
                <h3 className="mb-0">{Array.isArray(dashboard?.suspicious) ? dashboard.suspicious.length : "—"}</h3>
                <div className="text-muted small">+5 failed logins / hour</div>
              </div>
            </div>
          </div>

          {Array.isArray(dashboard?.suspicious) && dashboard.suspicious.length > 0 && (
            <div className="alert alert-warning d-flex align-items-center gap-2">
              <FiAlertTriangle size={20} />
              <div>
                <strong>Suspicious activity:</strong>{" "}
              {dashboard.suspicious.map((s, i) => (
                <span key={i}>
                  {i > 0 && ", "}
                  {s.ip_address || "unknown"} ({s.attempts} attempts)
                </span>
              ))}
              </div>
            </div>
          )}

          <ul className="nav nav-tabs mb-3">
            {TABS.map(([key, label]) => (
              <li className="nav-item" key={key}>
                <button className={`nav-link ${tab === key ? "active" : ""}`} onClick={() => setTab(key)}>
                  {label}
                </button>
              </li>
            ))}
          </ul>

          {tab === "events" && (
            <>
              <div className="card p-3 mb-3">
                <div className="row g-2">
                  <div className="col-md-3">
                    <input className="form-control" placeholder="Search description / IP"
                      value={evFilters.search}
                      onChange={(e) => { setEventPage(1); setEvFilters({ ...evFilters, search: e.target.value }); }} />
                  </div>
                  <div className="col-md-3">
                    <select className="form-select" value={evFilters.event_type}
                      onChange={(e) => { setEventPage(1); setEvFilters({ ...evFilters, event_type: e.target.value }); }}>
                      <option value="">All Event Types</option>
                      {["login_success", "login_failed", "logout", "password_change", "password_reset", "account_locked", "access_denied", "admin_action"].map((t) => (
                        <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
                      ))}
                    </select>
                  </div>
                  <div className="col-md-2">
                    <select className="form-select" value={evFilters.severity}
                      onChange={(e) => { setEventPage(1); setEvFilters({ ...evFilters, severity: e.target.value }); }}>
                      <option value="">All Severities</option>
                      {["info", "warning", "critical"].map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                  <div className="col-md-2">
                    <input className="form-control" type="date" value={evFilters.from}
                      onChange={(e) => { setEventPage(1); setEvFilters({ ...evFilters, from: e.target.value }); }}
                      aria-label="From date" />
                  </div>
                  <div className="col-md-2">
                    <input className="form-control" type="date" value={evFilters.to}
                      onChange={(e) => { setEventPage(1); setEvFilters({ ...evFilters, to: e.target.value }); }}
                      aria-label="To date" />
                  </div>
                </div>
              </div>

              {loadingSection ? (
                <Skeleton type="card" rows={6} />
              ) : events.length === 0 ? (
                <EmptyState icon={<FiActivity size={28} />} title="No security events" sub="Events matching your filters will appear here." />
              ) : (
                <div className="card shadow-sm">
                  <div className="table-responsive">
                    <table className="table table-hover align-middle mb-0">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Event</th>
                          <th>Severity</th>
                          <th>User</th>
                          <th>Description</th>
                          <th>IP</th>
                          <th>Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {events.map((e) => (
                          <tr key={e.id}>
                            <td>{e.id}</td>
                            <td>{String(e.event_type || "—").replace(/_/g, " ")}</td>
                            <td><span className={`badge ${SEVERITY_CLASS[e.severity] || "bg-secondary"}`}>{e.severity}</span></td>
                            <td>{e.user_name || "—"}</td>
                            <td className="text-muted small">{e.description || "—"}</td>
                            <td className="small">{e.ip_address || "—"}</td>
                            <td className="small text-muted">{formatDate(e.created_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="card-footer bg-white d-flex justify-content-end gap-2 align-items-center">
                    <span className="text-muted small me-2">{eventTotal} events</span>
                    <button className="btn btn-sm btn-outline-secondary" disabled={eventPage <= 1}
                      onClick={() => setEventPage(eventPage - 1)}>Prev</button>
                    <span className="small">Page {eventPage}/{eventTotalPages}</span>
                    <button className="btn btn-sm btn-outline-secondary" disabled={eventPage >= eventTotalPages}
                      onClick={() => setEventPage(eventPage + 1)}>Next</button>
                  </div>
                </div>
              )}
            </>
          )}

          {tab === "sessions" && (
            loadingSection ? (
              <Skeleton type="card" rows={6} />
            ) : sessions.length === 0 ? (
              <EmptyState icon={<FiUsers size={28} />} title="No active sessions" sub="Logged in sessions will appear here." />
            ) : (
              <div className="card shadow-sm">
                <div className="table-responsive">
                  <table className="table table-hover align-middle mb-0">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>User</th>
                        <th>Device</th>
                        <th>Started</th>
                        <th className="text-end">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sessions.map((s) => (
                        <tr key={s.id}>
                          <td>{s.id}</td>
                          <td>{s.user_name || `#${s.user_id}`}</td>
                          <td className="text-muted small">{s.device_info || "—"}</td>
                          <td className="small text-muted">{formatDate(s.created_at)}</td>
                          <td className="text-end">
                            <button className="btn btn-sm btn-outline-danger me-1" onClick={() => setRevokeId(s.id)}>
                              Revoke
                            </button>
                            <button className="btn btn-sm btn-outline-secondary" onClick={() => setRevokeAllId(s.user_id)}>
                              Revoke All
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          )}

          {tab === "passwords" && (
            loadingSection ? (
              <Skeleton type="card" rows={6} />
            ) : passwordChanges.length === 0 ? (
              <EmptyState icon={<FiKey size={28} />} title="No password changes" sub="Rejected password reset requests will appear here." />
            ) : (
              <div className="card shadow-sm">
                <div className="table-responsive">
                  <table className="table table-hover align-middle mb-0">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Email</th>
                        <th>Requested</th>
                        <th>Used</th>
                      </tr>
                    </thead>
                    <tbody>
                      {passwordChanges.map((p) => (
                        <tr key={p.id}>
                          <td>{p.id}</td>
                          <td>{p.email || "—"}</td>
                          <td className="small text-muted">{formatDate(p.created_at)}</td>
                          <td>
                            {p.used ? (
                              <span className="badge bg-success">Used</span>
                            ) : (
                              <span className="badge bg-warning text-dark">Pending</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          )}

          {tab === "audit" && (
            <>
              <div className="card p-3 mb-3">
                <div className="row g-2">
                  <div className="col-md-3">
                    <select className="form-select" value={auditFilters.action}
                      onChange={(e) => setAuditFilters({ ...auditFilters, action: e.target.value })}>
                      <option value="">All Actions</option>
                      {["LOGIN", "CREATE", "UPDATE", "DELETE", "CANCEL", "PAYMENT"].map((a) => (
                        <option key={a} value={a}>{a}</option>
                      ))}
                    </select>
                  </div>
                  <div className="col-md-3">
                    <input className="form-control" type="number" placeholder="User ID" value={auditFilters.user_id}
                      onChange={(e) => setAuditFilters({ ...auditFilters, user_id: e.target.value })} />
                  </div>
                  <div className="col-md-3">
                    <input className="form-control" type="date" value={auditFilters.from}
                      onChange={(e) => setAuditFilters({ ...auditFilters, from: e.target.value })}
                      aria-label="From date" />
                  </div>
                  <div className="col-md-3">
                    <input className="form-control" type="date" value={auditFilters.to}
                      onChange={(e) => setAuditFilters({ ...auditFilters, to: e.target.value })}
                      aria-label="To date" />
                  </div>
                </div>
              </div>

              {loadingSection ? (
                <Skeleton type="card" rows={6} />
              ) : auditLogs.length === 0 ? (
                <EmptyState icon={<FiShield size={28} />} title="No audit log entries" sub="Admin activity matching your filters will appear here." />
              ) : (
                <div className="card shadow-sm">
                  <div className="table-responsive">
                    <table className="table table-hover align-middle mb-0">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>User</th>
                          <th>Action</th>
                          <th>Module</th>
                          <th>Description</th>
                          <th>Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {auditLogs.map((l) => (
                          <tr key={l.id}>
                            <td>{l.id}</td>
                            <td>{l.user_name || `#${l.user_id}`}</td>
                            <td>{l.action || "—"}</td>
                            <td>{l.module || "—"}</td>
                            <td className="text-muted small">{l.description || "—"}</td>
                            <td className="small text-muted">{formatDate(l.created_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      <ConfirmModal
        open={revokeId !== null}
        title="Revoke session?"
        message="This will immediately invalidate the selected session."
        confirmLabel="Revoke"
        danger
        onConfirm={revokeSession}
        onCancel={() => setRevokeId(null)}
      />

      <ConfirmModal
        open={revokeAllId !== null}
        title="Revoke all sessions?"
        message={`This will sign out all active sessions for user #${revokeAllId ?? ""}.`}
        confirmLabel="Revoke All"
        danger
        onConfirm={revokeAll}
        onCancel={() => setRevokeAllId(null)}
      />
    </div>
  );
}