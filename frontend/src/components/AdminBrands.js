import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { useToast, ConfirmModal } from "./ui";

export default function AdminBrands() {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({ id: null, name: "", description: "" });
  const [loading, setLoading] = useState(true);
  const [deleteId, setDeleteId] = useState(null);
  const toast = useToast();

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get("/dms/brands");
      setRows(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error("Load brands error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const save = async (e) => {
    e.preventDefault();
    try {
      if (form.id) {
        await api.put(`/dms/brands/${form.id}`, {
          name: form.name,
          description: form.description,
        });
      } else {
        await api.post("/dms/brands", {
          name: form.name,
          description: form.description,
        });
      }
      reset();
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to save brand");
    }
  };

  const edit = (r) =>
    setForm({ id: r.id, name: r.name, description: r.description || "" });

  const remove = async () => {
    try {
      await api.delete(`/dms/brands/${deleteId}`);
      toast.success("Brand deleted");
      load();
    } catch (err) {
      toast.error("Delete failed. " + (err.response?.data?.error || ""));
    } finally {
      setDeleteId(null);
    }
  };

  const reset = () => setForm({ id: null, name: "", description: "" });

  return (
    <div className="container-fluid py-4">
      <h2 className="mb-4">Brands</h2>

      <form onSubmit={save} className="card p-3 mb-4 shadow-sm">
        <div className="row g-2">
          <div className="col-md-4">
            <input
              className="form-control"
              placeholder="Brand name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </div>
          <div className="col-md-6">
            <input
              className="form-control"
              placeholder="Description"
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
            />
          </div>
          <div className="col-md-2 d-flex gap-2">
            <button className="btn btn-primary flex-fill">
              {form.id ? "Update" : "Add"}
            </button>
            {form.id && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={reset}
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      </form>

      {loading ? (
        <div className="loading">Loading...</div>
      ) : (
        <table className="table table-striped shadow-sm">
          <thead>
            <tr>
              <th>#</th>
              <th>Name</th>
              <th>Description</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.id}</td>
                <td>{r.name}</td>
                <td>{r.description}</td>
                <td>
                  <span className="badge">{r.status}</span>
                </td>
                <td>
                  <button
                    className="btn btn-sm btn-warning me-2"
                    onClick={() => edit(r)}
                  >
                    Edit
                  </button>
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={() => setDeleteId(r.id)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <ConfirmModal
        open={deleteId !== null}
        title="Delete brand?"
        message="This will permanently remove this brand. This action cannot be undone."
        confirmLabel="Delete"
        danger
        onConfirm={remove}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
