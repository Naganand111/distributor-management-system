import React, { useEffect, useState, useCallback } from "react";
import api from "../lib/api";
import { formatDate } from "../lib/utils";
import { Skeleton, EmptyState, ConfirmModal } from "./ui";
import { useToast } from "./ui";
import {
  FiAward,
  FiGift,
  FiEdit2,
  FiPlus,
  FiCpu,
} from "react-icons/fi";

const CONFIG_EMPTY = {
  points_per_100_rupees: 10,
  redemption_min_points: 100,
  points_to_rupee: 1,
  expiry_days: 365,
  status: "active",
};

export default function AdminLoyalty() {
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [config, setConfig] = useState(CONFIG_EMPTY);
  const [configLoading, setConfigLoading] = useState(true);
  const [configSaving, setConfigSaving] = useState(false);

  const [dashboard, setDashboard] = useState(null);

  const [accounts, setAccounts] = useState([]);

  const [adjustModal, setAdjustModal] = useState(null);
  const [adjustForm, setAdjustForm] = useState({ points: "", note: "" });
  const [adjustSaving, setAdjustSaving] = useState(false);

  const [earnModal, setEarnModal] = useState(null);
  const [earnForm, setEarnForm] = useState({ orderId: "", amount: "" });
  const [earnSaving, setEarnSaving] = useState(false);

  const [txUser, setTxUser] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [txLoading, setTxLoading] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cfgRes, dashRes, accRes] = await Promise.all([
        api.get("/loyalty/config").catch(() => ({ data: null })),
        api.get("/loyalty/dashboard").catch(() => ({ data: null })),
        api.get("/loyalty/accounts").catch(() => ({ data: [] })),
      ]);
      if (cfgRes.data) {
        setConfig({
          points_per_100_rupees: cfgRes.data.points_per_100_rupees ?? 10,
          redemption_min_points: cfgRes.data.redemption_min_points ?? 100,
          points_to_rupee: cfgRes.data.points_to_rupee ?? 1,
          expiry_days: cfgRes.data.expiry_days ?? 365,
          status: cfgRes.data.status ?? "active",
        });
        setConfigLoading(false);
      }
      setDashboard(dashRes.data);
      setAccounts(Array.isArray(accRes.data) ? accRes.data : []);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to load loyalty data");
    } finally {
      setLoading(false);
      setConfigLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  /* ── config ── */

  const saveConfig = async () => {
    setConfigSaving(true);
    try {
      const res = await api.put("/loyalty/config", {
        points_per_100_rupees: Number(config.points_per_100_rupees),
        redemption_min_points: Number(config.redemption_min_points),
        points_to_rupee: Number(config.points_to_rupee),
        expiry_days: Number(config.expiry_days),
        status: config.status,
      });
      if (res.data) {
        setConfig({
          points_per_100_rupees: res.data.points_per_100_rupees ?? config.points_per_100_rupees,
          redemption_min_points: res.data.redemption_min_points ?? config.redemption_min_points,
          points_to_rupee: res.data.points_to_rupee ?? config.points_to_rupee,
          expiry_days: res.data.expiry_days ?? config.expiry_days,
          status: res.data.status ?? config.status,
        });
      }
      toast.success("Loyalty config updated");
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to update config");
    } finally {
      setConfigSaving(false);
    }
  };

  /* ── adjust ── */

  const openAdjust = (account, mode) => {
    setAdjustModal({ ...account, mode });
    setAdjustForm({ points: "", note: "" });
  };

  const submitAdjust = async () => {
    const pts = Number(adjustForm.points);
    if (!pts || pts === 0) return toast.error("Enter a valid points value");
    if (!adjustForm.note.trim()) return toast.error("Note is required for manual adjustments");

    setAdjustSaving(true);
    try {
      const payload = {
        userId: adjustModal.user_id,
        points: adjustModal.mode === "deduct" ? -Math.abs(pts) : Math.abs(pts),
        note: adjustForm.note.trim(),
      };
      await api.post("/loyalty/adjust", payload);
      toast.success(
        `${adjustModal.mode === "deduct" ? "Deducted" : "Added"} ${Math.abs(pts)} points`
      );
      setAdjustModal(null);
      loadAll();
    } catch (err) {
      toast.error(err.response?.data?.message || "Adjustment failed");
    } finally {
      setAdjustSaving(false);
    }
  };

  /* ── earn ── */

  const submitEarn = async () => {
    const amt = Number(earnForm.amount);
    const oid = Number(earnForm.orderId);
    if (!oid) return toast.error("Enter a valid order ID");
    if (!amt || amt <= 0) return toast.error("Enter a valid amount");

    setEarnSaving(true);
    try {
      await api.post("/loyalty/earn", {
        userId: earnModal.user_id,
        orderId: oid,
        amount: amt,
      });
      toast.success(`Earned points for order #${oid}`);
      setEarnModal(null);
      loadAll();
    } catch (err) {
      toast.error(err.response?.data?.message || "Earn failed");
    } finally {
      setEarnSaving(false);
    }
  };

  /* ── transactions ── */

  const openTransactions = async (account) => {
    setTxUser(account);
    setTransactions([]);
    setTxLoading(true);
    try {
      const res = await api.get("/loyalty/transactions", { params: { userId: account.user_id } });
      setTransactions(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      toast.error("Failed to load transactions");
    } finally {
      setTxLoading(false);
    }
  };

  /* ── render ── */

  if (loading) {
    return (
      <div className="container-fluid py-4">
        <h2 className="mb-4">Loyalty Program</h2>
        <Skeleton type="card" rows={6} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="container-fluid py-4">
        <h2 className="mb-4">Loyalty Program</h2>
        <div className="alert alert-danger">{error}</div>
      </div>
    );
  }

  return (
    <div className="container-fluid py-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h2 className="mb-0"><FiAward className="me-2" />Loyalty Program</h2>
        <button className="btn btn-outline-secondary" onClick={loadAll}>Refresh</button>
      </div>

      {/* ── Config ── */}
      <div className="card p-3 mb-4 shadow-sm">
        <div className="d-flex align-items-center mb-3">
          <FiCpu className="me-2 text-primary" />
          <h5 className="mb-0">Configuration</h5>
        </div>
        {configLoading ? (
          <Skeleton type="text" rows={3} />
        ) : (
          <div className="row g-3 align-items-end">
            <div className="col-md">
              <label className="form-label small text-muted">Points per ₹100</label>
              <input
                type="number"
                className="form-control"
                value={config.points_per_100_rupees}
                onChange={(e) => setConfig({ ...config, points_per_100_rupees: e.target.value })}
              />
            </div>
            <div className="col-md">
              <label className="form-label small text-muted">Min Redemption (pts)</label>
              <input
                type="number"
                className="form-control"
                value={config.redemption_min_points}
                onChange={(e) => setConfig({ ...config, redemption_min_points: e.target.value })}
              />
            </div>
            <div className="col-md">
              <label className="form-label small text-muted">Points → ₹</label>
              <input
                type="number"
                step="0.1"
                className="form-control"
                value={config.points_to_rupee}
                onChange={(e) => setConfig({ ...config, points_to_rupee: e.target.value })}
              />
            </div>
            <div className="col-md">
              <label className="form-label small text-muted">Expiry (days)</label>
              <input
                type="number"
                className="form-control"
                value={config.expiry_days}
                onChange={(e) => setConfig({ ...config, expiry_days: e.target.value })}
              />
            </div>
            <div className="col-md">
              <label className="form-label small text-muted">Status</label>
              <select
                className="form-select"
                value={config.status}
                onChange={(e) => setConfig({ ...config, status: e.target.value })}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
            <div className="col-md-auto">
              <button
                className="btn btn-primary"
                onClick={saveConfig}
                disabled={configSaving}
              >
                {configSaving ? "Saving…" : "Save Config"}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Dashboard ── */}
      {dashboard && (
        <div className="row g-3 mb-4">
          <div className="col-md-3 col-6">
            <div className="card p-3 text-center">
              <div className="text-muted small">Total Accounts</div>
              <div className="fs-4 fw-bold">{dashboard.total_accounts}</div>
            </div>
          </div>
          <div className="col-md-3 col-6">
            <div className="card p-3 text-center">
              <div className="text-muted small">Points Earned</div>
              <div className="fs-4 fw-bold text-success">{Number(dashboard.total_points_earned || 0).toLocaleString()}</div>
            </div>
          </div>
          <div className="col-md-3 col-6">
            <div className="card p-3 text-center">
              <div className="text-muted small">Points Redeemed</div>
              <div className="fs-4 fw-bold text-danger">{Number(dashboard.total_points_redeemed || 0).toLocaleString()}</div>
            </div>
          </div>
          <div className="col-md-3 col-6">
            <div className="card p-3 text-center">
              <div className="text-muted small">Active Members</div>
              <div className="fs-4 fw-bold text-primary">{dashboard.active_members}</div>
            </div>
          </div>
          {dashboard.recently_active && dashboard.recently_active.length > 0 && (
            <div className="col-12">
              <div className="card p-3">
                <h6 className="mb-3">Recently Active Members</h6>
                <div className="table-responsive">
                  <table className="table table-sm table-hover align-middle mb-0">
                    <thead>
                      <tr>
                        <th>User</th>
                        <th className="text-end">Balance</th>
                        <th className="text-end">Total Earned</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dashboard.recently_active.map((m) => (
                        <tr key={m.user_id}>
                          <td>{m.user_name || `User #${m.user_id}`}</td>
                          <td className="text-end">
                            <span className="badge bg-success">{Number(m.points_balance).toLocaleString()} pts</span>
                          </td>
                          <td className="text-end text-muted small">
                            {Number(m.total_earned).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Accounts ── */}
      <div className="card shadow-sm">
        <div className="card-header bg-white fw-semibold d-flex justify-content-between align-items-center">
          <span>Accounts</span>
          <span className="badge bg-primary">{accounts.length}</span>
        </div>
        {accounts.length === 0 ? (
          <div className="p-4">
            <EmptyState icon={<FiAward size={32} />} title="No loyalty accounts" sub="Accounts will appear once customers place orders." />
          </div>
        ) : (
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Email</th>
                  <th className="text-end">Balance</th>
                  <th className="text-end">Earned</th>
                  <th className="text-end">Redeemed</th>
                  <th className="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.user_id}>
                    <td className="fw-semibold">{a.user_name || `User #${a.user_id}`}</td>
                    <td className="text-muted small">{a.user_email}</td>
                    <td className="text-end">
                      <span className="badge bg-success fs-6">
                        {Number(a.points_balance).toLocaleString()}
                      </span>
                    </td>
                    <td className="text-end text-muted small">
                      {Number(a.total_earned).toLocaleString()}
                    </td>
                    <td className="text-end text-muted small">
                      {Number(a.total_redeemed).toLocaleString()}
                    </td>
                    <td className="text-end">
                      <div className="btn-group btn-group-sm">
                        <button
                          className="btn btn-outline-success"
                          title="Add points"
                          onClick={() => openAdjust(a, "add")}
                        >
                          <FiPlus size={14} />
                        </button>
                        <button
                          className="btn btn-outline-danger"
                          title="Deduct points"
                          onClick={() => openAdjust(a, "deduct")}
                        >
                          <FiEdit2 size={14} />
                        </button>
                        <button
                          className="btn btn-outline-primary"
                          title="Earn for order"
                          onClick={() => {
                            setEarnModal(a);
                            setEarnForm({ orderId: "", amount: "" });
                          }}
                        >
                          <FiGift size={14} />
                        </button>
                        <button
                          className="btn btn-outline-secondary"
                          title="Transaction history"
                          onClick={() => openTransactions(a)}
                        >
                          Txn
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Adjust Modal ── */}
      <ConfirmModal
        open={!!adjustModal}
        title={adjustModal ? `${adjustModal.mode === "deduct" ? "Deduct" : "Add"} Points — ${adjustModal.user_name || `User #${adjustModal.user_id}`}` : ""}
        message=""
        confirmLabel={adjustSaving ? "Saving…" : "Confirm"}
        danger={adjustModal?.mode === "deduct"}
        onConfirm={submitAdjust}
        onCancel={() => setAdjustModal(null)}
      />
      {adjustModal && (
        <div
          className="confirm-overlay"
          style={{ pointerEvents: adjustSaving ? "none" : "auto" }}
          onClick={() => !adjustSaving && setAdjustModal(null)}
        >
          <div className="confirm-box" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-title mb-3">
              {adjustModal.mode === "deduct" ? "Deduct" : "Add"} Points
            </div>
            <div className="mb-2">
              <label className="form-label small text-muted">
                {adjustModal.mode === "deduct" ? "Points to deduct" : "Points to add"}
              </label>
              <input
                type="number"
                min="1"
                className="form-control"
                placeholder="e.g. 50"
                value={adjustForm.points}
                onChange={(e) => setAdjustForm({ ...adjustForm, points: e.target.value })}
                disabled={adjustSaving}
              />
            </div>
            <div className="mb-3">
              <label className="form-label small text-muted">Note (required)</label>
              <input
                type="text"
                className="form-control"
                placeholder="Reason for adjustment"
                value={adjustForm.note}
                onChange={(e) => setAdjustForm({ ...adjustForm, note: e.target.value })}
                disabled={adjustSaving}
              />
            </div>
            <div className="confirm-actions">
              <button className="btn btn-light" onClick={() => setAdjustModal(null)} disabled={adjustSaving}>
                Cancel
              </button>
              <button
                className={`btn ${adjustModal.mode === "deduct" ? "btn-danger" : "btn-success"}`}
                onClick={submitAdjust}
                disabled={adjustSaving || !adjustForm.points || !adjustForm.note.trim()}
              >
                {adjustSaving ? "Saving…" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Earn Modal ── */}
      {earnModal && (
        <div
          className="confirm-overlay"
          style={{ pointerEvents: earnSaving ? "none" : "auto" }}
          onClick={() => !earnSaving && setEarnModal(null)}
        >
          <div className="confirm-box" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-title mb-3">
              Earn Points — {earnModal.user_name || `User #${earnModal.user_id}`}
            </div>
            <div className="mb-2">
              <label className="form-label small text-muted">Order ID</label>
              <input
                type="number"
                min="1"
                className="form-control"
                placeholder="e.g. 1234"
                value={earnForm.orderId}
                onChange={(e) => setEarnForm({ ...earnForm, orderId: e.target.value })}
                disabled={earnSaving}
              />
            </div>
            <div className="mb-3">
              <label className="form-label small text-muted">Order Amount (₹)</label>
              <input
                type="number"
                min="1"
                className="form-control"
                placeholder="e.g. 500"
                value={earnForm.amount}
                onChange={(e) => setEarnForm({ ...earnForm, amount: e.target.value })}
                disabled={earnSaving}
              />
            </div>
            <div className="confirm-actions">
              <button className="btn btn-light" onClick={() => setEarnModal(null)} disabled={earnSaving}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={submitEarn}
                disabled={earnSaving || !earnForm.orderId || !earnForm.amount}
              >
                {earnSaving ? "Saving…" : "Earn Points"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Transaction History Modal ── */}
      {txUser && (
        <div
          className="confirm-overlay"
          onClick={() => setTxUser(null)}
        >
          <div
            className="confirm-box"
            style={{ maxWidth: 700 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="confirm-title mb-2">
              Transactions — {txUser.user_name || `User #${txUser.user_id}`}
            </div>
            <div className="mb-3">
              <span className="badge bg-success me-2">Balance: {Number(txUser.points_balance).toLocaleString()} pts</span>
              <span className="badge bg-primary me-2">Earned: {Number(txUser.total_earned).toLocaleString()}</span>
              <span className="badge bg-danger">Redeemed: {Number(txUser.total_redeemed).toLocaleString()}</span>
            </div>
            {txLoading ? (
              <div className="text-center py-3 text-muted">Loading…</div>
            ) : transactions.length === 0 ? (
              <div className="text-center py-3 text-muted">No transactions yet</div>
            ) : (
              <div className="table-responsive" style={{ maxHeight: 400, overflow: "auto" }}>
                <table className="table table-sm table-hover align-middle mb-0">
                  <thead className="sticky-top bg-white">
                    <tr>
                      <th>Date</th>
                      <th>Type</th>
                      <th className="text-end">Points</th>
                      <th className="text-end">Balance After</th>
                      <th>Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((t) => (
                      <tr key={t.id}>
                        <td className="text-muted small">{formatDate(t.created_at)}</td>
                        <td>
                          <span className={`badge ${
                            t.type === "earn" ? "bg-success" :
                            t.type === "redeem" ? "bg-danger" :
                            "bg-warning text-dark"
                          }`}>
                            {t.type}
                          </span>
                          {t.reference_type === "order" && t.reference_id && (
                            <span className="badge bg-light text-dark ms-1">#{t.reference_id}</span>
                          )}
                        </td>
                        <td className="text-end fw-semibold">
                          <span className={Number(t.points) >= 0 ? "text-success" : "text-danger"}>
                            {Number(t.points) >= 0 ? "+" : ""}{Number(t.points).toLocaleString()}
                          </span>
                        </td>
                        <td className="text-end text-muted small">
                          {Number(t.balance_after).toLocaleString()}
                        </td>
                        <td className="text-muted small">{t.note || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="mt-3 text-end">
              <button className="btn btn-secondary" onClick={() => setTxUser(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
