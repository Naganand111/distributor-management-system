import React, { useEffect, useState } from "react";
import api from "../lib/api";
import { API_BASE_URL, API_ORIGIN } from "../lib/config";
import { useToast, ConfirmModal } from "./ui";

function getImageSrc(image) {
  if (!image) return "/no-image.png";
  if (/^https?:\/\//i.test(image)) return image;
  return `${API_ORIGIN}${image.startsWith("/") ? image : `/${image}`}`;
}

export default function AdminProducts() {
  const [products, setProducts] = useState([]);

  const [form, setForm] = useState({
    id: null,
    name: "",
    price: "",
    stock: "",
    description: "",
    image: "",
  });

  const [removeImageFlag, setRemoveImageFlag] = useState(false);

  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);

  const [deleteId, setDeleteId] = useState(null);
  const toast = useToast();

  /* 🔄 LOAD PRODUCTS */
  const load = async () => {
    try {
      const res = await api.get("/products");
      setProducts(Array.isArray(res.data.data) ? res.data.data : []);
    } catch (err) {
      console.error("Load error:", err);
    }
  };

  useEffect(() => {
    load();
  }, []);

  /* 📤 EXPORT CSV */
  const exportCsv = async () => {
    const token = localStorage.getItem("token");

    try {
      const res = await fetch(`${API_BASE_URL}/reports/products/csv`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!res.ok) {
        toast.error("Export failed");
        return;
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "products-report.csv";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Export error:", err);
      toast.error("Export failed");
    }
  };

  /* 📥 IMPORT CSV */
  const handleImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setImportResult(null);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await api.post("/products/import", formData);
      setImportResult(res.data);
      load();
    } catch (err) {
      setImportResult({
        error:
          err.response?.data?.message ||
          err.response?.data?.error ||
          "Import failed",
      });
    } finally {
      setImporting(false);
      e.target.value = "";
    }
  };

  /* 🖼 IMAGE UPLOAD */
  const handleUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("image", file);

    try {
      const res = await api.post("/upload", formData);

      setForm((prev) => ({
        ...prev,
        image: res.data.imageUrl,
      }));

      setRemoveImageFlag(false);
    } catch (err) {
      console.error("Upload failed:", err);
      toast.error("Upload failed");
    }
  };

  /* ❌ REMOVE IMAGE */
  const handleRemoveImage = () => {
    setForm((prev) => ({ ...prev, image: "" }));
    setRemoveImageFlag(true);
  };

  /* 💾 SAVE */
  const save = async (e) => {
    e.preventDefault();

    try {
      const payload = {
        name: form.name,
        price: form.price,
        stock: form.stock,
        description: form.description,
        image: form.image,
        removeImage: removeImageFlag,
      };

      if (form.id) {
        await api.put(`/products/${form.id}`, payload);
      } else {
        await api.post("/products", payload);
      }

      resetForm();
      load();
    } catch (err) {
      const msg =
        err.response?.data?.message ||
        err.response?.data?.error ||
        (typeof err.response?.data === "string"
          ? err.response.data
          : null) ||
        err.message;
      console.error("Save error:", err.response?.data || err.message);
      toast.error(`Failed to save product: ${msg}`);
    }
  };

  /* ✏ EDIT */
  const edit = (p) => {
    setForm({
      id: p.id,
      name: p.name,
      price: p.price,
      stock: p.stock,
      description: p.description,
      image: p.image || "",
    });

    setRemoveImageFlag(false);
  };

  /* 🗑 DELETE PRODUCT */
  const removeProduct = async () => {
    try {
      await api.delete(`/products/${deleteId}`);
      toast.success("Product deleted");
      load();
    } catch (err) {
      console.error("Delete error:", err);
      toast.error("Delete failed");
    } finally {
      setDeleteId(null);
    }
  };

  /* 🔄 RESET */
  const resetForm = () => {
    setForm({
      id: null,
      name: "",
      price: "",
      stock: "",
      description: "",
      image: "",
    });
    setRemoveImageFlag(false);
  };

  return (
    <div className="container py-4">
      <h2>📦 Manage Products</h2>

      {/* 📤📥 IMPORT / EXPORT TOOLBAR */}
      <div className="card p-3 mb-4 shadow-sm">
        <div className="d-flex flex-wrap gap-3 align-items-center">
          <button className="btn btn-outline-primary" onClick={exportCsv}>
            📤 Export CSV
          </button>

          <label className="btn btn-outline-secondary mb-0">
            {importing ? "Importing..." : "📥 Import CSV"}
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={handleImport}
              disabled={importing}
              style={{ display: "none" }}
            />
          </label>

          <small className="text-muted">
            CSV columns: <code>name,price,stock</code> (optional:{" "}
            <code>id,description,image</code>). Rows match by <code>id</code>,
            then by <code>name</code>, else new products are created.
          </small>
        </div>

        {importResult && (
          <div className="mt-3">
            {importResult.error ? (
              <div className="alert alert-danger mb-0">{importResult.error}</div>
            ) : (
              <div className="alert alert-info mb-0">
                ✅ Created <b>{importResult.summary.created}</b>, updated{" "}
                <b>{importResult.summary.updated}</b>, failed{" "}
                <b>{importResult.summary.failed}</b>
                {importResult.errors?.length > 0 && (
                  <ul className="mb-0 mt-2">
                    {importResult.errors.map((er, idx) => (
                      <li key={idx}>
                        Row {er.row}: {er.message}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* FORM */}
      <form onSubmit={save} className="card p-3 mb-4 shadow-sm">
        <input
          className="form-control mb-2"
          placeholder="Name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          required
        />

        <input
          type="number"
          className="form-control mb-2"
          placeholder="Price"
          value={form.price}
          onChange={(e) => setForm({ ...form, price: Number(e.target.value) })}
          required
        />

        <input
          type="number"
          className="form-control mb-2"
          placeholder="Stock"
          value={form.stock}
          onChange={(e) => setForm({ ...form, stock: Number(e.target.value) })}
          required
        />

        <textarea
          className="form-control mb-2"
          placeholder="Description"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />

        {/* IMAGE UPLOAD */}
        <input
          type="file"
          className="form-control mb-2"
          onChange={handleUpload}
        />

        {/* IMAGE PREVIEW */}
        {form.image && (
          <div>
            <img
              src={getImageSrc(form.image)}
              alt="preview"
              style={{
                width: "100px",
                borderRadius: "8px",
                marginBottom: "10px",
              }}
              onError={(e) => {
                e.target.src = "/no-image.png";
              }}
            />

            <button
              type="button"
              className="btn btn-sm btn-danger ms-2"
              onClick={handleRemoveImage}
            >
              Remove Image
            </button>
          </div>
        )}

        <button className="btn btn-primary">
          {form.id ? "Update" : "Add"}
        </button>

        {form.id && (
          <button
            type="button"
            className="btn btn-secondary ms-2"
            onClick={resetForm}
          >
            Cancel
          </button>
        )}
      </form>

      {/* TABLE */}
      <table className="table table-striped shadow-sm">
        <thead>
          <tr>
            <th>Image</th>
            <th>Name</th>
            <th>Price (₹)</th>
            <th>Stock</th>
            <th>Action</th>
          </tr>
        </thead>

        <tbody>
          {products.map((p) => (
            <tr key={p.id}>
              <td>
                <img
                  src={getImageSrc(p.image)}
                  alt=""
                  style={{
                    width: "50px",
                    height: "50px",
                    objectFit: "cover",
                    borderRadius: "6px",
                  }}
                  onError={(e) => {
                    e.target.src = "/no-image.png";
                  }}
                />
              </td>

              <td>{p.name}</td>
              <td>₹{p.price}</td>
              <td>{p.stock}</td>

              <td>
                <button
                  className="btn btn-sm btn-warning me-2"
                  onClick={() => edit(p)}
                >
                  Edit
                </button>

                <button
                  className="btn btn-sm btn-danger"
                  onClick={() => setDeleteId(p.id)}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <ConfirmModal
        open={deleteId !== null}
        title="Delete product?"
        message="This will permanently remove this product. This action cannot be undone."
        confirmLabel="Delete"
        danger
        onConfirm={removeProduct}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
