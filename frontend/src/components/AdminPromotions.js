import React, { useEffect, useState, useCallback } from "react";
import api from "../lib/api";
import { formatINR, formatDateOnly } from "../lib/utils";
import { Skeleton, EmptyState, ConfirmModal } from "./ui";
import { FiPlus, FiEdit2, FiTrash2, FiTag, FiToggleLeft, FiToggleRight } from "react-icons/fi";

const TYPES = ["percentage", "fixed", "buy_x_get_y", "min_order", "product", "category", "customer", "quantity"];

const EMPTY_FORM = {
  id: null,
  name: "",
  code: "",
  description: "",
  type: "percentage",
  value: "",
  min_order_value: "",
  buy_qty: "",
  get_qty: "",
  product_id: "",
  category_id: "",
  start_date: "",
  end_date: "",
  usage_limit: "",
  priority: "0",
  status: "active",
};

const statusBadge = (status) =>
  status === "active" ? (
    <span className="badge bg-success">Active</span>
  ) : (
    <span className="badge bg-secondary">Inactive</span>
  );

const valueLabel = (r) => {
  if (r.type === "percentage") return `${Number(r.value || 0)}%`;
  if (r.type === "buy_x_get_y") return `Buy ${r.buy_qty || "-"} Get ${r.get_qty || "-"}`;
  return formatINR(r.value);
};

export default function AdminPromotions() {
  const [rows, setRows] = useState([]);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState(null);
  const [togglingId, setTogglingId] = useState(null);

  const notify = (msg) => {
    setSuccess(msg);
    window.setTimeout(() => setSuccess(""), 3500);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get("/promotions");
      setRows(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to load promotions");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api
      .get("/products")
      .then((res) => setProducts(Array.isArray(res.data.data) ? res.data.data : []))
      .catch(() => {});
    api
      .get("/dms/categories")
      .then((res) => setCategories(Array.isArray(res.data) ? res.data : []))
      .catch(() => {});
  }, []);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const openEdit = (r) => {
    setForm({
      id: r.id,
      name: r.name || "",
      code: r.code || "",
      description: r.description || "",
      type: r.type || "percentage",
      value: r.value ?? "",
      min_order_value: r.min_order_value ?? "",
      buy_qty: r.buy_qty ?? "",
      get_qty: r.get_qty ?? "",
      product_id: r.product_id ?? "",
      category_id: r.category_id ?? "",
      start_date: r.start_date ? String(r.start_date).slice(0, 10) : "",
      end_date: r.end_date ? String(r.end_date).slice(0, 10) : "",
      usage_limit: r.usage_limit ?? "",
      priority: r.priority ?? "0",
      status: r.status || "active",
    });
    setShowForm(true);
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        code: form.code || null,
        description: form.description || null,
        type: form.type,
        value: form.value === "" ? 0 : Number(form.value),
        min_order_value: form.min_order_value === "" ? 0 : Number(form.min_order_value),
        buy_qty: form.buy_qty === "" ? null : Number(form.buy_qty),
        get_qty: form.get_qty === "" ? null : Number(form.get_qty),
        product_id: form.product_id === "" ? null : Number(form.product_id),
        category_id: form.category_id === "" ? null : Number(form.category_id),
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        usage_limit: form.usage_limit === "" ? null : Number(form.usage_limit),
        priority: Number(form.priority || 0),
        status: form.status,
      };
      if (form.id) {
        await api.put(`/promotions/${form.id}`, payload);
        notify("Promotion updated");
      } else {
        await api.post("/promotions", payload);
        notify("Promotion created");
      }
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to save promotion");
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (r) => {
    setTogglingId(r.id);
    try {
      await api.post(`/promotions/${r.id}/toggle`);
      notify(r.status === "active" ? "Promotion deactivated" : "Promotion activated");
      load();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to toggle promotion");
    } finally {
      setTogglingId(null);
    }
  };

  const remove = async () => {
    try {
      await api.delete(`/promotions/${deleteId}`);
      notify("Promotion deleted");
      load();
    } catch (err) {
      setError(err.response?.data?.error || "Delete failed");
    } finally {
      setDeleteId(null);
    }
  };

  return (
    <div className="container-fluid py-4">
      {/* HEADER */}
      <div className="d-flex justify-content-between align-items-center mb-4">
        <div>
          <h2 className="mb-1">Promotions</h2>
          <div className="text-muted">Create and manage promotional offers across your catalog.</div>
        </div>
        <button className="btn btn-primary" onClick={openCreate}>
          <FiPlus /> Create Promotion
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

      {loading ? (
        <Skeleton type="card" rows={6} />
      ) : rows.length === 0 ? (
        <div className="card">
          <div className="card-body">
            <EmptyState
              icon="🏷️"
              title="No promotions yet"
              sub="Create your first promotion to start driving sales."
              action={
                <button className="btn btn-primary" onClick={openCreate}>
                  <FiPlus /> Create Promotion
                </button>
              }
            />
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th className="text-end">Value</th>
                  <th className="text-end">Min Order</th>
                  <th>Valid Dates</th>
                  <th className="text-end">Usage</th>
                  <th className="text-end">Priority</th>
                  <th>Status</th>
                  <th className="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <div className="fw-semibold">{r.name}</div>
                      <div className="small text-muted">
                        {r.code ? `Code: ${r.code}` : "No code"}
                        {r.description ? ` · ${r.description}` : ""}
                      </div>
                    </td>
                    <td>
                      <span className="badge bg-info bg-opacity-25 text-dark">{r.type}</span>
                    </td>
                    <td className="text-end text-nowrap">{valueLabel(r)}</td>
                    <td className="text-end text-nowrap">{Number(r.min_order_value) > 0 ? formatINR(r.min_order_value) : "—"}</td>
                    <td className="text-nowrap">
                      {r.start_date ? formatDateOnly(r.start_date) : "—"} → {r.end_date ? formatDateOnly(r.end_date) : "∞"}
                    </td>
                    <td className="text-end text-nowrap">
                      <span className="badge bg-secondary">
                        {r.used_count ?? 0} / {r.usage_limit ?? "∞"}
                      </span>
                    </td>
                    <td className="text-end">{r.priority ?? 0}</td>
                    <td>{statusBadge(r.status)}</td>
                    <td className="text-end text-nowrap">
                      <button
                        className="btn btn-sm btn-light me-1"
                        title="Edit promotion"
                        onClick={() => openEdit(r)}
                      >
                        <FiEdit2 />
                      </button>
                      <button
                        className={`btn btn-sm ${r.status === "active" ? "btn-outline-secondary" : "btn-outline-success"} me-1`}
                        title={r.status === "active" ? "Deactivate promotion" : "Activate promotion"}
                        disabled={togglingId === r.id}
                        onClick={() => toggle(r)}
                      >
                        {r.status === "active" ? <FiToggleRight /> : <FiToggleLeft />}
                      </button>
                      <button
                        className="btn btn-sm btn-danger"
                        title="Delete promotion"
                        disabled={togglingId === r.id}
                        onClick={() => setDeleteId(r.id)}
                      >
                        <FiTrash2 />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* CREATE / EDIT MODAL */}
      {showForm && (
        <div
          className="confirm-overlay"
          onClick={() => !saving && setShowForm(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Promotion form"
        >
          <div
            className="confirm-box"
            style={{ maxWidth: 820, width: "94vw", maxHeight: "88vh", overflowY: "auto" }}
            onClick={(e) => e.stopPropagation()}
          >
            <form onSubmit={save}>
              <div className="confirm-icon">
                <FiTag />
              </div>
              <div className="confirm-title">{form.id ? "Edit Promotion" : "Create Promotion"}</div>
              <div className="confirm-msg text-start">
                <div className="row g-3">
                  <div className="col-md-6">
                    <label className="form-label small fw-bold">Name *</label>
                    <input
                      className="form-control"
                      required
                      value={form.name}
                      onChange={set("name")}
                      placeholder="e.g. Summer Sale"
                      disabled={saving}
                    />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label small fw-bold">Code</label>
                    <input
                      className="form-control"
                      value={form.code}
                      onChange={set("code")}
                      placeholder="e.g. SUMMER10"
                      disabled={saving}
                    />
                  </div>
                  <div className="col-12">
                    <label className="form-label small fw-bold">Description</label>
                    <input
                      className="form-control"
                      value={form.description}
                      onChange={set("description")}
                      placeholder="Optional description"
                      disabled={saving}
                    />
                  </div>
                  <div className="col-md-4">
                    <label className="form-label small fw-bold">Type *</label>
                    <select className="form-select" value={form.type} onChange={set("type")} disabled={saving}>
                      {TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>
                  {form.type === "buy_x_get_y" ? (
                    <>
                      <div className="col-md-4">
                        <label className="form-label small fw-bold">Buy Qty *</label>
                        <input
                          className="form-control"
                          type="number"
                          min="1"
                          required
                          value={form.buy_qty}
                          onChange={set("buy_qty")}
                          placeholder="e.g. 2"
                          disabled={saving}
                        />
                      </div>
                      <div className="col-md-4">
                        <label className="form-label small fw-bold">Get Qty *</label>
                        <input
                          className="form-control"
                          type="number"
                          min="1"
                          required
                          value={form.get_qty}
                          onChange={set("get_qty")}
                          placeholder="e.g. 1"
                          disabled={saving}
                        />
                      </div>
                    </>
                  ) : (
                    <div className="col-md-4">
                      <label className="form-label small fw-bold">Value *</label>
                      <input
                        className="form-control"
                        type="number"
                        step="0.01"
                        required
                        value={form.value}
                        onChange={set("value")}
                        placeholder={form.type === "percentage" ? "e.g. 10" : "e.g. 100"}
                        disabled={saving}
                      />
                    </div>
                  )}
                  <div className="col-md-4">
                    <label className="form-label small fw-bold">Min Order Value</label>
                    <input
                      className="form-control"
                      type="number"
                      step="0.01"
                      min="0"
                      value={form.min_order_value}
                      onChange={set("min_order_value")}
                      placeholder="0"
                      disabled={saving}
                    />
                  </div>
                  {(form.type === "product" || form.type === "quantity") && (
                    <div className="col-md-4">
                      <label className="form-label small fw-bold">Product</label>
                      <select className="form-select" value={form.product_id} onChange={set("product_id")} disabled={saving}>
                        <option value="">Any product</option>
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {form.type === "category" && (
                    <div className="col-md-4">
                      <label className="form-label small fw-bold">Category</label>
                      <select className="form-select" value={form.category_id} onChange={set("category_id")} disabled={saving}>
                        <option value="">Any category</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div className="col-md-3">
                    <label className="form-label small fw-bold">Start Date</label>
                    <input className="form-control" type="date" value={form.start_date} onChange={set("start_date")} disabled={saving} />
                  </div>
                  <div className="col-md-3">
                    <label className="form-label small fw-bold">End Date</label>
                    <input className="form-control" type="date" value={form.end_date} onChange={set("end_date")} disabled={saving} />
                  </div>
                  <div className="col-md-3">
                    <label className="form-label small fw-bold">Usage Limit</label>
                    <input
                      className="form-control"
                      type="number"
                      min="0"
                      value={form.usage_limit}
                      onChange={set("usage_limit")}
                      placeholder="Unlimited"
                      disabled={saving}
                    />
                  </div>
                  <div className="col-md-3">
                    <label className="form-label small fw-bold">Priority</label>
                    <input className="form-control" type="number" value={form.priority} onChange={set("priority")} disabled={saving} />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label small fw-bold">Status</label>
                    <select className="form-select" value={form.status} onChange={set("status")} disabled={saving}>
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </select>
                  </div>
                </div>
              </div>
              <div className="confirm-actions">
                <button type="button" className="btn btn-light" disabled={saving} onClick={() => setShowForm(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? "Saving…" : form.id ? "Update" : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DELETE CONFIRM */}
      <ConfirmModal
        open={deleteId !== null}
        title="Delete promotion?"
        message="This will soft-delete the promotion by setting it inactive. This action can be undone by toggling it active again."
        confirmLabel="Delete"
        danger
        onConfirm={remove}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}