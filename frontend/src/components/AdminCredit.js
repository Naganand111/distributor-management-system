import React, { useEffect, useState, useCallback } from "react";
import api from "../lib/api";
import { formatINR, formatDate, formatDateOnly } from "../lib/utils";
import { Skeleton, EmptyState } from "./ui";
import { getUser } from "../lib/auth";
import {
  FiTrendingUp,
  FiAlertTriangle,
  FiCalendar,
  FiDollarSign,
  FiEdit3,
  FiUpload,
  FiEye,
  FiRefreshCw,
} from "react-icons/fi";

const PAYMENT_METHODS = ["cash", "upi", "bank_transfer", "cheque", "razorpay"];

const txBadge = (t) => {
  const cls =
    { CREDIT: "danger", PAYMENT: "success", ADJUSTMENT: "warning", REFUND: "info" }[t] || "secondary";
  return <span className={`badge bg-${cls}`}>{t}</span>;
};

const signedAmount = (t) => {
  if (t.transaction_type === "PAYMENT") return `-${formatINR(t.amount)}`;
  if (t.transaction_type === "ADJUSTMENT" && Number(t.amount) < 0)
    return `-${formatINR(Math.abs(Number(t.amount)))}`;
  return `+${formatINR(t.amount)}`;
};

export default function AdminCredit() {
  const user = getUser();
  const isAdmin = user?.role === "admin";

  const [summary, setSummary] = useState({});
  const [retailers, setRetailers] = useState([]);
  const [overdue, setOverdue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [ledgerTarget, setLedgerTarget] = useState(null);
  const [ledgerData, setLedgerData] = useState(null);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerError, setLedgerError] = useState("");

  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustTarget, setAdjustTarget] = useState(null);
  const [adjustDirection, setAdjustDirection] = useState("increase");
  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [adjustDue, setAdjustDue] = useState("");

  const [collectOpen, setCollectOpen] = useState(false);
  const [collectTarget, setCollectTarget] = useState(null);
  const [collectAmount, setCollectAmount] = useState("");
  const [collectMethod, setCollectMethod] = useState("cash");
  const [collectRef, setCollectRef] = useState("");
  const [collectDate, setCollectDate] = useState("");
  const [collectNotes, setCollectNotes] = useState("");

  const [submitting, setSubmitting] = useState("");

  const notify = (msg) => {
    setSuccess(msg);
    window.setTimeout(() => setSuccess(""), 3500);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [dashRes, overdueRes] = await Promise.all([
        api.get("/credit/dashboard"),
        api.get("/credit/overdue").catch(() => ({ data: [] })),
      ]);
      setSummary(dashRes.data.summary || {});
      setRetailers(Array.isArray(dashRes.data.retailers) ? dashRes.data.retailers : []);
      setOverdue(Array.isArray(overdueRes.data) ? overdueRes.data : []);
      notify("Credit dashboard refreshed");
    } catch (err) {
      setError(err.response?.data?.error || "Failed to load credit dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openLedger = async (r) => {
    setLedgerTarget(r);
    setLedgerOpen(true);
    setLedgerData(null);
    setLedgerLoading(true);
    setLedgerError("");
    try {
      const res = await api.get(`/credit/retailer/${r.id}`);
      setLedgerData(res.data);
    } catch (err) {
      setLedgerError(err.response?.data?.error || "Failed to load retailer ledger");
    } finally {
      setLedgerLoading(false);
    }
  };

  const loadFullLedger = async () => {
    setLedgerLoading(true);
    setLedgerError("");
    try {
      const res = await api.get(`/credit/retailer/${ledgerTarget.id}/ledger`);
      setLedgerData((prev) => ({
        ...prev,
        transactions: Array.isArray(res.data) ? res.data : [],
      }));
      notify("Full ledger loaded");
    } catch (err) {
      setLedgerError(err.response?.data?.error || "Failed to load full ledger");
    } finally {
      setLedgerLoading(false);
    }
  };

  const openAdjust = (r) => {
    setAdjustTarget(r);
    setAdjustDirection("increase");
    setAdjustAmount("");
    setAdjustReason("");
    setAdjustDue("");
    setAdjustOpen(true);
  };

  const submitAdjust = async (e) => {
    e.preventDefault();
    setSubmitting("adjust");
    try {
      const sign = adjustDirection === "decrease" ? -1 : 1;
      const res = await api.post(`/credit/retailer/${adjustTarget.id}/adjust`, {
        amount: sign * Number(adjustAmount),
        notes: adjustReason || "Manual adjustment",
        due_date: adjustDue || null,
      });
      notify(`Balance updated to ${formatINR(res.data.outstanding_balance)}`);
      setAdjustOpen(false);
      load();
    } catch (err) {
      setError(err.response?.data?.error || "Adjustment failed");
    } finally {
      setSubmitting("");
    }
  };

  const openCollect = (r) => {
    setCollectTarget(r);
    setCollectAmount("");
    setCollectMethod("cash");
    setCollectRef("");
    setCollectDate("");
    setCollectNotes("");
    setCollectOpen(true);
  };

  const submitCollect = async (e) => {
    e.preventDefault();
    setSubmitting("collect");
    try {
      const res = await api.post(`/credit/retailer/${collectTarget.id}/collect`, {
        amount: Number(collectAmount),
        payment_method: collectMethod,
        reference_number: collectRef || null,
        collection_date: collectDate || null,
        notes: collectNotes || null,
      });
      notify(`Collection ${res.data.collection_number} recorded`);
      setCollectOpen(false);
      load();
    } catch (err) {
      setError(err.response?.data?.error || "Collection failed");
    } finally {
      setSubmitting("");
    }
  };

  const summaryCards = [
    { key: "totalOutstanding", label: "Total Outstanding", icon: FiDollarSign, tone: "text-danger" },
    { key: "overdue", label: "Overdue", icon: FiAlertTriangle, tone: "text-warning", suffix: (s) => `${s.overdueRetailerCount || 0} retailers` },
    { key: "totalCollections", label: "Total Collections", icon: FiTrendingUp, tone: "text-success", suffix: (s) => `${s.collectionCount || 0} collections` },
    { key: "dueThisWeek", label: "Due This Week", icon: FiCalendar, tone: "text-primary" },
    { key: "dueThisMonth", label: "Due This Month", icon: FiCalendar, tone: "text-info" },
  ];

  if (loading) {
    return (
      <>
        <Skeleton type="card" rows={6} />
        <div className="mt-3">
          <Skeleton type="table" rows={5} />
        </div>
      </>
    );
  }

  return (
    <div className="container-fluid py-4">
      {/* HEADER */}
      <div className="d-flex justify-content-between align-items-center mb-4">
        <div>
          <h2 className="mb-1">Retailer Credit</h2>
          <div className="text-muted">Track retailer outstanding balances, overdue dues and collections.</div>
        </div>
        <button className="btn btn-outline-secondary" onClick={load} title="Refresh credit dashboard">
          <FiRefreshCw /> Refresh
        </button>
      </div>

      {/* ERROR */}
      {error && (
        <div className="alert alert-danger d-flex justify-content-between align-items-center">
          <span>{error}</span>
          <button type="button" className="btn-close" aria-label="Dismiss" onClick={() => setError("")} />
        </div>
      )}

      {/* SUCCESS */}
      {success && (
        <div className="alert alert-success d-flex justify-content-between align-items-center">
          <span>{success}</span>
          <button type="button" className="btn-close" aria-label="Dismiss" onClick={() => setSuccess("")} />
        </div>
      )}

      {/* SUMMARY CARDS */}
      <div className="row g-3 mb-4">
        {summaryCards.slice(0, 3).map(({ key, label, icon: Icon, tone }) => (
          <div className="col-6 col-md-4" key={key}>
            <div className="card p-3 h-100">
              <div className="d-flex justify-content-between align-items-center">
                <div>
                  <div className="text-muted small">{label}</div>
                  <div className={`fs-4 fw-bold ${tone}`}>{formatINR(summary[key])}</div>
                  <div className="small text-muted">{summaryCards.find((c) => c.key === key).suffix ? summaryCards.find((c) => c.key === key).suffix(summary) : ""}</div>
                </div>
                <Icon className={`fs-3 ${tone}`} />
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="row g-3 mb-4">
        {summaryCards.slice(3).map(({ key, label, icon: Icon, tone }) => (
          <div className="col-6 col-md-4" key={key}>
            <div className="card p-3 h-100">
              <div className="d-flex justify-content-between align-items-center">
                <div>
                  <div className="text-muted small">{label}</div>
                  <div className={`fs-4 fw-bold ${tone}`}>{formatINR(summary[key])}</div>
                </div>
                <Icon className={`fs-3 ${tone}`} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* OVERDUE RETAILERS */}
      <div className="card mb-4">
        <div className="card-header d-flex justify-content-between align-items-center">
          <span>
            <FiAlertTriangle className="me-2" /> Overdue Retailers
          </span>
          <span className="badge bg-warning text-dark">{overdue.length}</span>
        </div>
        <div className="card-body p-0">
          {overdue.length === 0 ? (
            <EmptyState
              title="No overdue retailers"
              sub="Retailers with overdue credit dues will be listed here."
            />
          ) : (
            <div className="table-responsive">
              <table className="table table-hover align-middle mb-0">
                <thead>
                  <tr>
                    <th>Retailer</th>
                    <th className="text-end">Credit Limit</th>
                    <th className="text-end">Outstanding</th>
                    <th className="text-end">Overdue</th>
                    <th>Oldest Due</th>
                    <th className="text-end">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {overdue.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <div className="fw-semibold">{r.name}</div>
                        <div className="small text-muted">
                          {r.shop_name || r.retailer_code}
                        </div>
                      </td>
                      <td className="text-end">{Number(r.credit_limit) > 0 ? formatINR(r.credit_limit) : "—"}</td>
                      <td className="text-end text-danger fw-semibold">{formatINR(r.outstanding_balance)}</td>
                      <td className="text-end text-warning fw-semibold">{formatINR(r.overdue)}</td>
                      <td className="small text-muted">{r.oldest_due_date ? formatDateOnly(r.oldest_due_date) : "—"}</td>
                      <td className="text-end text-nowrap">
                        <button className="btn btn-sm btn-light me-1" title="View ledger" onClick={() => openLedger(r)}>
                          <FiEye />
                        </button>
                        <button
                          className="btn btn-sm btn-outline-primary me-1"
                          title={isAdmin ? "Adjust outstanding balance" : "Admin access required"}
                          disabled={!isAdmin}
                          onClick={() => openAdjust(r)}
                        >
                          <FiEdit3 />
                        </button>
                        <button
                          className="btn btn-sm btn-outline-success"
                          title={Number(r.outstanding_balance) > 0 ? "Record collection" : "No outstanding dues"}
                          disabled={Number(r.outstanding_balance) <= 0}
                          onClick={() => openCollect(r)}
                        >
                          <FiUpload />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ALL RETAILER BALANCES */}
      <div className="card">
        <div className="card-header d-flex justify-content-between align-items-center">
          <span>Retailer Balances</span>
          <span className="badge bg-primary">{retailers.length}</span>
        </div>
        <div className="card-body p-0">
          {retailers.length === 0 ? (
            <EmptyState
              title="No active retailers"
              sub="Retailers with credit accounts will appear here."
            />
          ) : (
            <div className="table-responsive">
              <table className="table table-hover align-middle mb-0">
                <thead>
                  <tr>
                    <th>Retailer</th>
                    <th className="text-end">Credit Limit</th>
                    <th className="text-end">Outstanding</th>
                    <th className="text-end">Overdue</th>
                    <th className="text-end">Available Credit</th>
                    <th className="text-end">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {retailers.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <div className="fw-semibold">{r.name}</div>
                        <div className="small text-muted">
                          {r.shop_name || r.retailer_code}
                        </div>
                      </td>
                      <td className="text-end">{Number(r.credit_limit) > 0 ? formatINR(r.credit_limit) : "—"}</td>
                      <td className="text-end fw-semibold">{formatINR(r.outstanding_balance)}</td>
                      <td className="text-end">
                        {Number(r.overdue) > 0 ? (
                          <span className="badge bg-warning text-dark">{formatINR(r.overdue)}</span>
                        ) : (
                          <span className="badge bg-success">On time</span>
                        )}
                      </td>
                      <td className="text-end">{r.available_credit !== null && r.available_credit !== undefined ? formatINR(r.available_credit) : "—"}</td>
                      <td className="text-end text-nowrap">
                        <button className="btn btn-sm btn-light me-1" title="View ledger" onClick={() => openLedger(r)}>
                          <FiEye />
                        </button>
                        <button
                          className="btn btn-sm btn-outline-primary me-1"
                          title={isAdmin ? "Adjust outstanding balance" : "Admin access required"}
                          disabled={!isAdmin}
                          onClick={() => openAdjust(r)}
                        >
                          <FiEdit3 />
                        </button>
                        <button
                          className="btn btn-sm btn-outline-success"
                          title={Number(r.outstanding_balance) > 0 ? "Record collection" : "No outstanding dues"}
                          disabled={Number(r.outstanding_balance) <= 0}
                          onClick={() => openCollect(r)}
                        >
                          <FiUpload />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* LEDGER MODAL */}
      {ledgerOpen && ledgerTarget && (
        <div
          className="confirm-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setLedgerOpen(false);
          }}
          role="dialog"
          aria-modal="true"
          aria-label="Retailer credit ledger"
        >
          <div
            className="confirm-box"
            style={{ maxWidth: 960, width: "94vw", maxHeight: "88vh", overflowY: "auto" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="confirm-icon">
              <FiEye />
            </div>
            <div className="confirm-title">
              {ledgerTarget.name}
              <div className="small text-muted fw-normal">
                {ledgerTarget.retailer_code}
                {ledgerTarget.shop_name ? ` · ${ledgerTarget.shop_name}` : ""}
              </div>
            </div>
            <div className="confirm-msg">
              {ledgerError && (
                <div className="alert alert-danger py-2">
                  {ledgerError}
                  <button type="button" className="btn-close float-end" aria-label="Dismiss" onClick={() => setLedgerError("")} />
                </div>
              )}

              {ledgerLoading && !ledgerData ? (
                <Skeleton type="table" rows={5} />
              ) : ledgerData ? (
                <>
                  <div className="row g-2 mb-3">
                    {[
                      ["Credit Limit", ledgerData.retailer?.credit_limit],
                      ["Outstanding", ledgerData.retailer?.outstanding_balance],
                      ["Available Credit", ledgerData.retailer?.available_credit],
                      ["Overdue", ledgerData.retailer?.overdue],
                    ].map(([label, val]) => (
                      <div className="col-6 col-md-3" key={label}>
                        <div className="border rounded p-2 px-3">
                          <div className="small text-muted">{label}</div>
                          <div className="fw-semibold">{val === null || val === undefined ? "—" : formatINR(val)}</div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="d-flex gap-2 mb-3">
                    <button
                      className="btn btn-sm btn-outline-primary"
                      title={isAdmin ? "Adjust outstanding balance" : "Admin access required"}
                      disabled={!isAdmin}
                      onClick={() => {
                        setLedgerOpen(false);
                        openAdjust(ledgerTarget);
                      }}
                    >
                      <FiEdit3 /> Adjust
                    </button>
                    <button
                      className="btn btn-sm btn-outline-success"
                      title={
                        Number(ledgerTarget.outstanding_balance) > 0
                          ? "Record collection"
                          : "No outstanding dues"
                      }
                      disabled={Number(ledgerTarget.outstanding_balance) <= 0}
                      onClick={() => {
                        setLedgerOpen(false);
                        openCollect(ledgerTarget);
                      }}
                    >
                      <FiUpload /> Record Collection
                    </button>
                    <button className="btn btn-sm btn-light ms-auto" onClick={loadFullLedger} disabled={ledgerLoading}>
                      {ledgerLoading ? "Loading…" : "Load Full Ledger"}
                    </button>
                  </div>

                  <h6 className="fw-bold">Transactions</h6>
                  <div className="table-responsive mb-3">
                    <table className="table table-sm table-hover align-middle mb-0">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Type</th>
                          <th className="text-end">Amount</th>
                          <th className="text-end">Balance</th>
                          <th>Due Date</th>
                          <th>Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ledgerData.transactions && ledgerData.transactions.length > 0 ? (
                          ledgerData.transactions.map((t) => (
                            <tr key={t.id}>
                              <td className="small text-muted">{formatDate(t.created_at)}</td>
                              <td>{txBadge(t.transaction_type)}</td>
                              <td className="text-end text-nowrap">{signedAmount(t)}</td>
                              <td className="text-end">{formatINR(t.balance_after)}</td>
                              <td className="small text-muted">{t.due_date ? formatDateOnly(t.due_date) : "—"}</td>
                              <td className="small text-muted">{t.notes || "—"}</td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={6} className="text-center py-4 text-muted">
                              No transactions yet
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  <h6 className="fw-bold">Collections</h6>
                  <div className="table-responsive">
                    <table className="table table-sm table-hover align-middle mb-0">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Number</th>
                          <th className="text-end">Amount</th>
                          <th>Method</th>
                          <th>Reference</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ledgerData.collections && ledgerData.collections.length > 0 ? (
                          ledgerData.collections.map((c) => (
                            <tr key={c.id}>
                              <td className="small text-muted">{formatDate(c.collection_date || c.created_at)}</td>
                              <td className="fw-semibold">{c.collection_number}</td>
                              <td className="text-end">{formatINR(c.amount)}</td>
                              <td>
                                <span className="badge bg-light text-dark">{c.payment_method}</span>
                              </td>
                              <td className="small text-muted">{c.reference_number || "—"}</td>
                              <td>
                                <span className={`badge bg-${c.status === "completed" ? "success" : "warning"} text-${c.status === "completed" ? "white" : "dark"}`}>
                                  {c.status}
                                </span>
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={6} className="text-center py-4 text-muted">
                              No collections recorded
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <p className="text-center py-4 text-muted">No ledger data available</p>
              )}
            </div>
            <div className="confirm-actions">
              <button className="btn btn-light" onClick={() => setLedgerOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ADJUST MODAL */}
      {adjustOpen && adjustTarget && (
        <div
          className="confirm-overlay"
          onClick={() => !submitting && setAdjustOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Adjust credit balance"
        >
          <div className="confirm-box" onClick={(e) => e.stopPropagation()}>
            <form onSubmit={submitAdjust}>
              <div className="confirm-icon">
                <FiEdit3 />
              </div>
              <div className="confirm-title">Adjust Balance</div>
              <div className="confirm-msg text-start">
                <div className="mb-2 text-muted small">
                  {adjustTarget.name} · Outstanding: <strong>{formatINR(adjustTarget.outstanding_balance)}</strong>
                </div>
                <label className="form-label small fw-bold">Direction</label>
                <select
                  className="form-select mb-3"
                  value={adjustDirection}
                  onChange={(e) => setAdjustDirection(e.target.value)}
                  disabled={!!submitting}
                >
                  <option value="increase">Increase (add debt)</option>
                  <option value="decrease">Decrease (reduce debt)</option>
                </select>
                <label className="form-label small fw-bold">Amount</label>
                <input
                  className="form-control mb-3"
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={adjustAmount}
                  onChange={(e) => setAdjustAmount(e.target.value)}
                  placeholder="e.g. 500.00"
                  disabled={!!submitting}
                />
                <label className="form-label small fw-bold">Reason</label>
                <input
                  className="form-control mb-3"
                  value={adjustReason}
                  maxLength={200}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  placeholder="e.g. credit note, pricing correction"
                  disabled={!!submitting}
                />
                <label className="form-label small fw-bold">Due Date (optional)</label>
                <input
                  className="form-control"
                  type="date"
                  value={adjustDue}
                  onChange={(e) => setAdjustDue(e.target.value)}
                  disabled={!!submitting}
                />
              </div>
              <div className="confirm-actions">
                <button type="button" className="btn btn-light" disabled={!!submitting} onClick={() => setAdjustOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={!!submitting}>
                  {submitting === "adjust" ? "Adjusting…" : "Apply Adjustment"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* COLLECT MODAL */}
      {collectOpen && collectTarget && (
        <div
          className="confirm-overlay"
          onClick={() => !submitting && setCollectOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Record collection"
        >
          <div className="confirm-box" onClick={(e) => e.stopPropagation()}>
            <form onSubmit={submitCollect}>
              <div className="confirm-icon">
                <FiUpload />
              </div>
              <div className="confirm-title">Record Collection</div>
              <div className="confirm-msg text-start">
                <div className="mb-2 text-muted small">
                  {collectTarget.name} · Outstanding: <strong>{formatINR(collectTarget.outstanding_balance)}</strong>
                </div>
                <label className="form-label small fw-bold">Amount</label>
                <input
                  className="form-control mb-3"
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={Number(collectTarget.outstanding_balance)}
                  required
                  value={collectAmount}
                  onChange={(e) => setCollectAmount(e.target.value)}
                  placeholder="e.g. 1000.00"
                  disabled={!!submitting}
                />
                <label className="form-label small fw-bold">Payment Method</label>
                <select
                  className="form-select mb-3"
                  value={collectMethod}
                  onChange={(e) => setCollectMethod(e.target.value)}
                  disabled={!!submitting}
                >
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <label className="form-label small fw-bold">Reference Number</label>
                <input
                  className="form-control mb-3"
                  value={collectRef}
                  maxLength={100}
                  onChange={(e) => setCollectRef(e.target.value)}
                  placeholder="Optional UPI ref / cheque no."
                  disabled={!!submitting}
                />
                <label className="form-label small fw-bold">Collection Date</label>
                <input
                  className="form-control mb-3"
                  type="date"
                  value={collectDate}
                  onChange={(e) => setCollectDate(e.target.value)}
                  disabled={!!submitting}
                />
                <label className="form-label small fw-bold">Notes</label>
                <input
                  className="form-control"
                  value={collectNotes}
                  maxLength={200}
                  onChange={(e) => setCollectNotes(e.target.value)}
                  placeholder="Optional notes"
                  disabled={!!submitting}
                />
              </div>
              <div className="confirm-actions">
                <button type="button" className="btn btn-light" disabled={!!submitting} onClick={() => setCollectOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-success" disabled={!!submitting}>
                  {submitting === "collect" ? "Recording…" : "Record Collection"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}