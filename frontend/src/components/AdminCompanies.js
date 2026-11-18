import React, { useEffect, useState, useCallback } from "react";
import api from "../lib/api";
import { formatINR } from "../lib/utils";
import { Skeleton, EmptyState, ConfirmModal } from "./ui";
import { useToast } from "./ui";
import {
  FiHome,
  FiMapPin,
  FiEdit2,
  FiTrash2,
} from "react-icons/fi";

const COMPANY_EMPTY = {
  name: "",
  code: "",
  gstin: "",
  email: "",
  phone: "",
  address: "",
  city: "",
  state: "",
};

const BRANCH_EMPTY = {
  company_id: "",
  name: "",
  code: "",
  address: "",
  city: "",
  state: "",
  manager_name: "",
};

export default function AdminCompanies() {
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [companies, setCompanies] = useState([]);
  const [branches, setBranches] = useState([]);

  const [companyForm, setCompanyForm] = useState({ id: null, ...COMPANY_EMPTY });
  const [branchForm, setBranchForm] = useState({ id: null, ...BRANCH_EMPTY });
  const [companySaving, setCompanySaving] = useState(false);
  const [branchSaving, setBranchSaving] = useState(false);

  const [deleteCompany, setDeleteCompany] = useState(null);
  const [deleteBranch, setDeleteBranch] = useState(null);

  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [coRes, brRes] = await Promise.all([
        api.get("/companies").catch(() => ({ data: [] })),
        api.get("/branches").catch(() => ({ data: [] })),
      ]);
      setCompanies(Array.isArray(coRes.data) ? coRes.data : []);
      setBranches(Array.isArray(brRes.data) ? brRes.data : []);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /* ── company CRUD ── */

  const saveCompany = async (e) => {
    e.preventDefault();
    setCompanySaving(true);
    try {
      const payload = { ...companyForm };
      delete payload.id;
      if (companyForm.id) {
        await api.put(`/companies/${companyForm.id}`, payload);
        toast.success("Company updated");
      } else {
        await api.post("/companies", payload);
        toast.success("Company created");
      }
      setCompanyForm({ id: null, ...COMPANY_EMPTY });
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to save company");
    } finally {
      setCompanySaving(false);
    }
  };

  const removeCompany = async () => {
    try {
      await api.delete(`/companies/${deleteCompany}`);
      toast.success("Company deactivated");
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || "Delete failed");
    } finally {
      setDeleteCompany(null);
    }
  };

  /* ── branch CRUD ── */

  const saveBranch = async (e) => {
    e.preventDefault();
    setBranchSaving(true);
    try {
      const payload = { ...branchForm };
      delete payload.id;
      if (branchForm.id) {
        await api.put(`/branches/${branchForm.id}`, payload);
        toast.success("Branch updated");
      } else {
        await api.post("/branches", payload);
        toast.success("Branch created");
      }
      setBranchForm({ id: null, ...BRANCH_EMPTY });
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to save branch");
    } finally {
      setBranchSaving(false);
    }
  };

  const removeBranch = async () => {
    try {
      await api.delete(`/branches/${deleteBranch}`);
      toast.success("Branch deactivated");
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || "Delete failed");
    } finally {
      setDeleteBranch(null);
    }
  };

  /* ── summary ── */

  const showSummary = async (company) => {
    setSummary(null);
    setSummaryLoading(true);
    try {
      const res = await api.get(`/companies/${company.id}/summary`);
      setSummary({ ...res.data, company_name: company.name });
    } catch (err) {
      toast.error("Failed to load summary");
    } finally {
      setSummaryLoading(false);
    }
  };

  /* ── helpers ── */

  const companyMap = {};
  companies.forEach((c) => (companyMap[c.id] = c.name));

  const statusBadge = (status) => {
    const cls = status === "active" ? "bg-success" : "bg-secondary";
    return <span className={`badge ${cls}`}>{status}</span>;
  };

  /* ── render ── */

  if (loading) {
    return (
      <div className="container-fluid py-4">
        <h2 className="mb-4">Companies &amp; Branches</h2>
        <Skeleton type="card" rows={6} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="container-fluid py-4">
        <h2 className="mb-4">Companies &amp; Branches</h2>
        <div className="alert alert-danger">{error}</div>
      </div>
    );
  }

  return (
    <div className="container-fluid py-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h2 className="mb-0"><FiHome className="me-2" />Companies &amp; Branches</h2>
        <button className="btn btn-outline-secondary" onClick={load}>Refresh</button>
      </div>

      <div className="row g-4">
        {/* ══ LEFT: Companies ══ */}
        <div className="col-lg-7">
          {/* Company Form */}
          <div className="card p-3 mb-4 shadow-sm">
            <h6 className="mb-3">{companyForm.id ? "Edit Company" : "Add Company"}</h6>
            <form onSubmit={saveCompany}>
              <div className="row g-2">
                <div className="col-md-4">
                  <label className="form-label small text-muted">Name *</label>
                  <input
                    className="form-control"
                    required
                    value={companyForm.name}
                    onChange={(e) => setCompanyForm({ ...companyForm, name: e.target.value })}
                  />
                </div>
                <div className="col-md-4">
                  <label className="form-label small text-muted">Code *</label>
                  <input
                    className="form-control"
                    required
                    value={companyForm.code}
                    onChange={(e) => setCompanyForm({ ...companyForm, code: e.target.value })}
                    disabled={companyForm.id === 1}
                    title={companyForm.id === 1 ? "Default company code cannot be changed" : ""}
                  />
                </div>
                <div className="col-md-4">
                  <label className="form-label small text-muted">GSTIN</label>
                  <input
                    className="form-control"
                    value={companyForm.gstin}
                    onChange={(e) => setCompanyForm({ ...companyForm, gstin: e.target.value })}
                  />
                </div>
                <div className="col-md-4">
                  <label className="form-label small text-muted">Email</label>
                  <input
                    type="email"
                    className="form-control"
                    value={companyForm.email}
                    onChange={(e) => setCompanyForm({ ...companyForm, email: e.target.value })}
                  />
                </div>
                <div className="col-md-4">
                  <label className="form-label small text-muted">Phone</label>
                  <input
                    className="form-control"
                    value={companyForm.phone}
                    onChange={(e) => setCompanyForm({ ...companyForm, phone: e.target.value })}
                  />
                </div>
                <div className="col-md-4">
                  <label className="form-label small text-muted">City</label>
                  <input
                    className="form-control"
                    value={companyForm.city}
                    onChange={(e) => setCompanyForm({ ...companyForm, city: e.target.value })}
                  />
                </div>
                <div className="col-md-6">
                  <label className="form-label small text-muted">Address</label>
                  <input
                    className="form-control"
                    value={companyForm.address}
                    onChange={(e) => setCompanyForm({ ...companyForm, address: e.target.value })}
                  />
                </div>
                <div className="col-md-6">
                  <label className="form-label small text-muted">State</label>
                  <input
                    className="form-control"
                    value={companyForm.state}
                    onChange={(e) => setCompanyForm({ ...companyForm, state: e.target.value })}
                  />
                </div>
              </div>
              <div className="d-flex gap-2 mt-3">
                <button className="btn btn-primary" disabled={companySaving}>
                  {companySaving ? "Saving…" : companyForm.id ? "Update" : "Add Company"}
                </button>
                {companyForm.id && (
                  <button
                    type="button"
                    className="btn btn-light"
                    onClick={() => setCompanyForm({ id: null, ...COMPANY_EMPTY })}
                  >
                    Cancel
                  </button>
                )}
              </div>
            </form>
          </div>

          {/* Companies Table */}
          <div className="card shadow-sm">
            <div className="card-header bg-white fw-semibold d-flex justify-content-between align-items-center">
              <span>Companies</span>
              <span className="badge bg-primary">{companies.length}</span>
            </div>
            {companies.length === 0 ? (
              <div className="p-4">
                <EmptyState icon={<FiHome size={32} />} title="No companies" sub="Add your first company above." />
              </div>
            ) : (
              <div className="table-responsive">
                <table className="table table-hover align-middle mb-0">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Code</th>
                      <th>City</th>
                      <th className="text-center">Branches</th>
                      <th>Status</th>
                      <th className="text-end">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {companies.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <button
                            className="btn btn-link p-0 fw-semibold text-decoration-none"
                            onClick={() => showSummary(c)}
                          >
                            {c.name}
                          </button>
                          {c.gstin && <div className="text-muted small">{c.gstin}</div>}
                        </td>
                        <td>{c.code}</td>
                        <td>{c.city || "—"}</td>
                        <td className="text-center">
                          <span className="badge bg-light text-dark">{c.branch_count ?? 0}</span>
                        </td>
                        <td>{statusBadge(c.status)}</td>
                        <td className="text-end">
                          <button
                            className="btn btn-sm btn-outline-primary me-1"
                            title="Edit"
                            onClick={() => {
                              setCompanyForm({
                                id: c.id,
                                name: c.name || "",
                                code: c.code || "",
                                gstin: c.gstin || "",
                                email: c.email || "",
                                phone: c.phone || "",
                                address: c.address || "",
                                city: c.city || "",
                                state: c.state || "",
                              });
                            }}
                          >
                            <FiEdit2 size={14} />
                          </button>
                          <button
                            className="btn btn-sm btn-outline-danger"
                            title={c.id === 1 ? "Default company is protected" : "Deactivate"}
                            disabled={c.id === 1}
                            onClick={() => setDeleteCompany(c.id)}
                          >
                            <FiTrash2 size={14} />
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

        {/* ══ RIGHT: Branches ══ */}
        <div className="col-lg-5">
          {/* Branch Form */}
          <div className="card p-3 mb-4 shadow-sm">
            <h6 className="mb-3">{branchForm.id ? "Edit Branch" : "Add Branch"}</h6>
            <form onSubmit={saveBranch}>
              <div className="mb-2">
                <label className="form-label small text-muted">Company *</label>
                <select
                  className="form-select"
                  required
                  value={branchForm.company_id}
                  onChange={(e) => setBranchForm({ ...branchForm, company_id: e.target.value })}
                >
                  <option value="">Select company…</option>
                  {companies.filter((c) => c.status === "active").map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div className="row g-2">
                <div className="col-8">
                  <label className="form-label small text-muted">Name *</label>
                  <input
                    className="form-control"
                    required
                    value={branchForm.name}
                    onChange={(e) => setBranchForm({ ...branchForm, name: e.target.value })}
                  />
                </div>
                <div className="col-4">
                  <label className="form-label small text-muted">Code *</label>
                  <input
                    className="form-control"
                    required
                    value={branchForm.code}
                    onChange={(e) => setBranchForm({ ...branchForm, code: e.target.value })}
                  />
                </div>
              </div>
              <div className="row g-2 mt-1">
                <div className="col-6">
                  <label className="form-label small text-muted">City</label>
                  <input
                    className="form-control"
                    value={branchForm.city}
                    onChange={(e) => setBranchForm({ ...branchForm, city: e.target.value })}
                  />
                </div>
                <div className="col-6">
                  <label className="form-label small text-muted">State</label>
                  <input
                    className="form-control"
                    value={branchForm.state}
                    onChange={(e) => setBranchForm({ ...branchForm, state: e.target.value })}
                  />
                </div>
              </div>
              <div className="mt-2">
                <label className="form-label small text-muted">Address</label>
                <input
                  className="form-control"
                  value={branchForm.address}
                  onChange={(e) => setBranchForm({ ...branchForm, address: e.target.value })}
                />
              </div>
              <div className="mt-2">
                <label className="form-label small text-muted">Manager Name</label>
                <input
                  className="form-control"
                  value={branchForm.manager_name}
                  onChange={(e) => setBranchForm({ ...branchForm, manager_name: e.target.value })}
                />
              </div>
              <div className="d-flex gap-2 mt-3">
                <button className="btn btn-primary" disabled={branchSaving}>
                  {branchSaving ? "Saving…" : branchForm.id ? "Update" : "Add Branch"}
                </button>
                {branchForm.id && (
                  <button
                    type="button"
                    className="btn btn-light"
                    onClick={() => setBranchForm({ id: null, ...BRANCH_EMPTY })}
                  >
                    Cancel
                  </button>
                )}
              </div>
            </form>
          </div>

          {/* Branches Table */}
          <div className="card shadow-sm">
            <div className="card-header bg-white fw-semibold d-flex justify-content-between align-items-center">
              <span>Branches</span>
              <span className="badge bg-primary">{branches.length}</span>
            </div>
            {branches.length === 0 ? (
              <div className="p-4">
                <EmptyState icon={<FiMapPin size={32} />} title="No branches" sub="Add your first branch above." />
              </div>
            ) : (
              <div className="table-responsive">
                <table className="table table-hover align-middle mb-0">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Company</th>
                      <th>City</th>
                      <th>Manager</th>
                      <th>Status</th>
                      <th className="text-end">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {branches.map((b) => (
                      <tr key={b.id}>
                        <td>
                          <span className="fw-semibold">{b.name}</span>
                          <div className="text-muted small">{b.code}</div>
                        </td>
                        <td className="text-muted small">{b.company_name || `#${b.company_id}`}</td>
                        <td>{b.city || "—"}</td>
                        <td className="text-muted small">{b.manager_name || "—"}</td>
                        <td>{statusBadge(b.status)}</td>
                        <td className="text-end">
                          <button
                            className="btn btn-sm btn-outline-primary me-1"
                            title="Edit"
                            onClick={() => {
                              setBranchForm({
                                id: b.id,
                                company_id: b.company_id || "",
                                name: b.name || "",
                                code: b.code || "",
                                address: b.address || "",
                                city: b.city || "",
                                state: b.state || "",
                                manager_name: b.manager_name || "",
                              });
                            }}
                          >
                            <FiEdit2 size={14} />
                          </button>
                          <button
                            className="btn btn-sm btn-outline-danger"
                            title="Deactivate"
                            onClick={() => setDeleteBranch(b.id)}
                          >
                            <FiTrash2 size={14} />
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
      </div>

      {/* ── Delete Company Confirm ── */}
      <ConfirmModal
        open={deleteCompany !== null}
        title="Deactivate company?"
        message="This will set the company status to inactive. Branches under it will remain but the company will no longer be selectable."
        confirmLabel="Deactivate"
        danger
        onConfirm={removeCompany}
        onCancel={() => setDeleteCompany(null)}
      />

      {/* ── Delete Branch Confirm ── */}
      <ConfirmModal
        open={deleteBranch !== null}
        title="Deactivate branch?"
        message="This will set the branch status to inactive."
        confirmLabel="Deactivate"
        danger
        onConfirm={removeBranch}
        onCancel={() => setDeleteBranch(null)}
      />

      {/* ── Summary Modal ── */}
      {(summary || summaryLoading) && (
        <div
          className="confirm-overlay"
          onClick={() => setSummary(null)}
        >
          <div className="confirm-box" onClick={(e) => e.stopPropagation()}>
            {summaryLoading ? (
              <div className="text-center py-4 text-muted">Loading summary…</div>
            ) : summary ? (
              <>
                <div className="confirm-title mb-3">
                  {summary.company_name} — Summary
                </div>
                <div className="row g-3">
                  <div className="col-4 text-center">
                    <div className="fs-3 fw-bold">{summary.order_count}</div>
                    <div className="text-muted small">Orders</div>
                  </div>
                  <div className="col-4 text-center">
                    <div className="fs-3 fw-bold">{formatINR(summary.revenue)}</div>
                    <div className="text-muted small">Revenue</div>
                  </div>
                  <div className="col-4 text-center">
                    <div className="fs-3 fw-bold">{summary.user_count}</div>
                    <div className="text-muted small">Users</div>
                  </div>
                </div>
                <div className="mt-4 text-end">
                  <button className="btn btn-secondary" onClick={() => setSummary(null)}>Close</button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
