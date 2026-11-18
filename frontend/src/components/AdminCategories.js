import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { useToast, PageHeader, ConfirmModal, EmptyState, StatusBadge } from "./ui";

export default function AdminCategories() {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({ id: null, name: "", description: "" });
  const [loading, setLoading] = useState(true);
  const [deleteId, setDeleteId] = useState(null);
  const toast = useToast();

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get("/dms/categories");
      setRows(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      toast.error("Failed to load categories");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async (e) => {
    e.preventDefault();
    try {
      if (form.id) {
        await api.put(`/dms/categories/${form.id}`, { name: form.name, description: form.description });
        toast.success("Category updated");
      } else {
        await api.post("/dms/categories", { name: form.name, description: form.description });
        toast.success("Category added");
      }
      reset();
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to save category");
    }
  };

  const edit = (r) => setForm({ id: r.id, name: r.name, description: r.description || "" });

  const remove = async () => {
    try {
      await api.delete(`/dms/categories/${deleteId}`);
      toast.success("Category deleted");
      load();
    } catch (err) {
      toast.error("Delete failed. " + (err.response?.data?.error || ""));
    } finally {
      setDeleteId(null);
    }
  };

  const reset = () => setForm({ id: null, name: "", description: "" });

  return (
    <div>
      <PageHeader
        title="Categories"
        subtitle="Organize your catalog into categories."
      />

      <div className="card mb-4">
        <form onSubmit={save} className="card-body">
          <div className="row g-2">
            <div className="col-md-4">
              <label className="form-label">Category name</label>
              <input
                className="form-control"
                placeholder="e.g. Electronics"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </div>
            <div className="col-md-6">
              <label className="form-label">Description</label>
              <input
                className="form-control"
                placeholder="Optional description"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
            <div className="col-md-2 d-flex gap-2 align-items-end">
              <button className="btn btn-primary flex-fill">
                {form.id ? "Update" : "Add"}
              </button>
              {form.id && (
                <button type="button" className="btn btn-light" onClick={reset}>
                  Cancel
                </button>
              )}
            </div>
          </div>
        </form>
      </div>

      {loading ? (
        <div className="loading">Loading...</div>
      ) : rows.length === 0 ? (
        <div className="card"><EmptyState title="No categories yet" sub="Add your first category above." /></div>
      ) : (
        <div className="card">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Name</th>
                  <th>Description</th>
                  <th>Status</th>
                  <th className="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.id}</td>
                    <td className="fw-semibold">{r.name}</td>
                    <td>{r.description}</td>
                    <td><StatusBadge status={r.status} /></td>
                    <td className="text-end">
                      <button className="btn btn-sm btn-light me-2" onClick={() => edit(r)}>
                        Edit
                      </button>
                      <button className="btn btn-sm btn-danger" onClick={() => setDeleteId(r.id)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ConfirmModal
        open={deleteId !== null}
        title="Delete category?"
        message="This will permanently remove this category. This action cannot be undone."
        confirmLabel="Delete"
        danger
        onConfirm={remove}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
