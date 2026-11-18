import React, { useCallback, useEffect, useState } from "react";
import api from "../lib/api";
import { Skeleton, EmptyState, ConfirmModal, useToast } from "./ui";
import { FiPlus, FiEdit2, FiPackage, FiTruck } from "react-icons/fi";

const TRANSFER_FLOW = { requested: "approved", approved: "dispatched", dispatched: "received", received: "completed" };
const TRANSFER_LABELS = { requested: "Requested", approved: "Approved", dispatched: "Dispatched", received: "Received", completed: "Completed", cancelled: "Cancelled" };
const TRANSFER_COLORS = { requested: "warning", approved: "info", dispatched: "primary", received: "success", completed: "dark", cancelled: "danger" };
const TRANSFER_ACTION = { requested: "Approve", approved: "Dispatch", dispatched: "Receive", received: "Complete" };

const EMPTY_WAREHOUSE_FORM = { name: "", code: "", address: "", city: "", state: "", manager_name: "", phone: "", status: "active" };

export default function AdminWarehouses() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [warehouses, setWarehouses] = useState([]);
  const [transfers, setTransfers] = useState([]);
  const [products, setProducts] = useState([]);
  const [saving, setSaving] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_WAREHOUSE_FORM);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const [invOpen, setInvOpen] = useState(false);
  const [invLoading, setInvLoading] = useState(false);
  const [invWarehouse, setInvWarehouse] = useState(null);
  const [inventory, setInventory] = useState([]);

  const [transferOpen, setTransferOpen] = useState(false);
  const [transferForm, setTransferForm] = useState({ from_warehouse_id: "", to_warehouse_id: "", note: "" });
  const [transferItems, setTransferItems] = useState([{ product_id: "", quantity: 1 }]);

  const loadWarehouses = useCallback(async () => {
    const res = await api.get("/warehouses");
    setWarehouses(Array.isArray(res.data) ? res.data : []);
  }, []);

  const loadTransfers = useCallback(async () => {
    const res = await api.get("/warehouses/transfers");
    setTransfers(Array.isArray(res.data) ? res.data : []);
  }, []);

  const loadProducts = useCallback(async () => {
    try {
      const res = await api.get("/products");
      setProducts(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error("Load products error:", err);
    }
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      await Promise.all([loadWarehouses(), loadTransfers(), loadProducts()]);
    } catch (err) {
      setError(err.response?.data?.error || err.response?.data?.message || "Failed to load warehouses");
    } finally {
      setLoading(false);
    }
  }, [loadWarehouses, loadTransfers, loadProducts]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const openCreate = () => { setEditing(null); setForm(EMPTY_WAREHOUSE_FORM); setModalOpen(true); };

  const openEdit = (wh) => { setEditing(wh); setForm({ ...EMPTY_WAREHOUSE_FORM, ...wh }); setModalOpen(true); };

  const openDelete = (wh) => { setDeleteTarget(wh); setDeleteOpen(true); };

  const submitWarehouse = async () => {
    if (!form.name.trim() || !form.code.trim()) { toast.error("Name and code are required"); return; }
    setSaving(true);
    try {
      if (editing) {
        await api.put(`/warehouses/${editing.id}`, form);
        toast.success("Warehouse updated");
      } else {
        await api.post("/warehouses", form);
        toast.success("Warehouse created");
      }
      setModalOpen(false);
      loadWarehouses();
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to save warehouse");
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    try {
      await api.delete(`/warehouses/${deleteTarget.id}`);
      toast.success("Warehouse deactivated");
      setDeleteOpen(false);
      loadWarehouses();
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to deactivate warehouse");
    }
  };

  const openInventory = async (wh) => {
    setInvWarehouse(wh);
    setInvOpen(true);
    setInvLoading(true);
    setInventory([]);
    try {
      const res = await api.get(`/warehouses/${wh.id}/inventory`);
      setInventory(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to load inventory");
    } finally {
      setInvLoading(false);
    }
  };

  const addTransferItem = () => setTransferItems([...transferItems, { product_id: "", quantity: 1 }]);

  const updateTransferItem = (i, key, val) => {
    const next = [...transferItems];
    next[i] = { ...next[i], [key]: val };
    setTransferItems(next);
  };

  const removeTransferItem = (i) => setTransferItems(transferItems.filter((_, idx) => idx !== i));

  const openTransfer = () => {
    setTransferForm({ from_warehouse_id: "", to_warehouse_id: "", note: "" });
    setTransferItems([{ product_id: "", quantity: 1 }]);
    setTransferOpen(true);
  };

  const submitTransfer = async () => {
    const items = transferItems.filter((i) => i.product_id && Number(i.quantity) > 0);
    if (!transferForm.from_warehouse_id || !transferForm.to_warehouse_id) { toast.error("Select source and destination warehouses"); return; }
    if (transferForm.from_warehouse_id === transferForm.to_warehouse_id) { toast.error("Source and destination must be different"); return; }
    if (!items.length) { toast.error("Add at least one item"); return; }
    setSaving(true);
    try {
      await api.post("/warehouses/transfers", {
        ...transferForm,
        items: items.map((i) => ({ product_id: Number(i.product_id), quantity: Number(i.quantity) })),
      });
      toast.success("Transfer created");
      setTransferOpen(false);
      loadTransfers();
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to create transfer");
    } finally {
      setSaving(false);
    }
  };

  const advanceTransfer = async (t) => {
    const next = TRANSFER_FLOW[t.status];
    if (!next) return;
    try {
      await api.put(`/warehouses/transfers/${t.id}/status`, { status: next });
      toast.success(`Transfer status updated to ${TRANSFER_LABELS[next]}`);
      loadTransfers();
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to update transfer status");
    }
  };

  const cancelTransfer = async (t) => {
    try {
      await api.put(`/warehouses/transfers/${t.id}/status`, { status: "cancelled" });
      toast.success("Transfer cancelled");
      loadTransfers();
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to cancel transfer");
    }
  };

  return (
    <div className="container-fluid py-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h2 className="mb-0"><FiPackage className="me-2" />Warehouses</h2>
        <div className="d-flex gap-2">
          <button className="btn btn-outline-secondary" onClick={loadAll}>Refresh</button>
          <button className="btn btn-primary" onClick={openCreate}><FiPlus className="me-1" />Add Warehouse</button>
        </div>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      {loading ? (
        <Skeleton type="card" rows={6} />
      ) : (
        <>
          {warehouses.length === 0 ? (
            <div className="card"><EmptyState icon={<FiPackage />} title="No warehouses yet" sub="Create your first warehouse to manage inventory." /></div>
          ) : (
            <div className="row g-3 mb-4">
              {warehouses.map((w) => (
                <div className="col-md-6 col-xl-4" key={w.id}>
                  <div className="card shadow-sm p-3 h-100">
                    <div className="d-flex justify-content-between align-items-start mb-2">
                      <div>
                        <h6 className="mb-0">{w.name}</h6>
                        <span className="text-muted small">{w.code}{w.status === "inactive" ? " · INACTIVE" : ""}</span>
                      </div>
                      <div className="d-flex gap-1">
                        <button className="btn btn-sm btn-outline-secondary" title="Edit" onClick={() => openEdit(w)}><FiEdit2 /></button>
                        <button className="btn btn-sm btn-outline-danger" title="Deactivate" onClick={() => openDelete(w)}>×</button>
                      </div>
                    </div>
                    <p className="text-muted small mb-2">{w.address || "—"}, {w.city || "—"}, {w.state || "—"}</p>
                    <div className="text-muted small mb-2">Manager: <strong>{w.manager_name || "—"}</strong> · Phone: <strong>{w.phone || "—"}</strong></div>
                    <div className="d-flex justify-content-between align-items-center">
                      <div className="small">
                        <div>{w.product_count} products</div>
                        <div>{w.total_stock} units in stock</div>
                      </div>
                      <button className="btn btn-sm btn-outline-primary" onClick={() => openInventory(w)}>Inventory</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="d-flex justify-content-between align-items-center mb-3 mt-4">
            <h5 className="mb-0">Stock Transfers</h5>
            <button className="btn btn-sm btn-primary" onClick={openTransfer} disabled={warehouses.length < 2} title={warehouses.length < 2 ? "Need at least two warehouses" : ""}>
              <FiPlus className="me-1" />New Transfer
            </button>
          </div>

          {transfers.length === 0 ? (
            <div className="card"><EmptyState title="No transfers yet" sub="Create a transfer to move stock between warehouses." /></div>
          ) : (
            <div className="card shadow-sm">
              <div className="table-responsive">
                <table className="table table-striped mb-0 align-middle">
                  <thead>
                    <tr>
                      <th>Transfer #</th><th>From</th><th>To</th><th>Items</th><th>Note</th><th>Status</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {transfers.map((t) => (
                      <tr key={t.id}>
                        <td className="fw-bold">{t.transfer_number}</td>
                        <td>{t.from_warehouse_name || "—"}</td>
                        <td>{t.to_warehouse_name || "—"}</td>
                        <td>{t.item_count}</td>
                        <td className="small text-muted">{t.note || "—"}</td>
                        <td><span className={`badge bg-${TRANSFER_COLORS[t.status] || "secondary"}`}>{TRANSFER_LABELS[t.status] || t.status}</span></td>
                        <td className="text-end">
                          {TRANSFER_FLOW[t.status] && (
                            <button className="btn btn-sm btn-outline-primary me-1" onClick={() => advanceTransfer(t)}>
                              {TRANSFER_ACTION[t.status]}
                            </button>
                          )}
                          {(t.status === "requested" || t.status === "approved") && (
                            <button className="btn btn-sm btn-outline-danger" onClick={() => cancelTransfer(t)}>Cancel</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {modalOpen && (
        <div className="confirm-overlay" onClick={() => !saving && setModalOpen(false)} role="dialog" aria-modal="true" aria-label="Warehouse form">
          <div className="confirm-box" style={{ width: 600 }} onClick={(e) => e.stopPropagation()}>
            <div className="confirm-title">{editing ? "Edit Warehouse" : "Add Warehouse"}</div>
            <div className="confirm-msg text-start">
              <div className="row g-2 mb-2">
                <div className="col-6">
                  <label className="form-label small fw-bold">Name *</label>
                  <input className="form-control" value={form.name} disabled={saving} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
                <div className="col-6">
                  <label className="form-label small fw-bold">Code *</label>
                  <input className="form-control" value={form.code} disabled={saving} onChange={(e) => setForm({ ...form, code: e.target.value })} />
                </div>
              </div>
              <label className="form-label small fw-bold">Address</label>
              <input className="form-control mb-2" value={form.address} disabled={saving} onChange={(e) => setForm({ ...form, address: e.target.value })} />
              <div className="row g-2 mb-2">
                <div className="col-6">
                  <label className="form-label small fw-bold">City</label>
                  <input className="form-control" value={form.city} disabled={saving} onChange={(e) => setForm({ ...form, city: e.target.value })} />
                </div>
                <div className="col-6">
                  <label className="form-label small fw-bold">State</label>
                  <input className="form-control" value={form.state} disabled={saving} onChange={(e) => setForm({ ...form, state: e.target.value })} />
                </div>
              </div>
              <div className="row g-2 mb-3">
                <div className="col-6">
                  <label className="form-label small fw-bold">Manager Name</label>
                  <input className="form-control" value={form.manager_name} disabled={saving} onChange={(e) => setForm({ ...form, manager_name: e.target.value })} />
                </div>
                <div className="col-6">
                  <label className="form-label small fw-bold">Phone</label>
                  <input className="form-control" value={form.phone} disabled={saving} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                </div>
              </div>
              {editing && (
                <label className="form-label small fw-bold">Status</label>
              )}
              {editing && (
                <select className="form-select" value={form.status} disabled={saving} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              )}
            </div>
            <div className="confirm-actions">
              <button className="btn btn-light" disabled={saving} onClick={() => setModalOpen(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={saving} onClick={submitWarehouse}>{saving ? "Saving..." : editing ? "Update Warehouse" : "Create Warehouse"}</button>
            </div>
          </div>
        </div>
      )}

      {invOpen && (
        <div className="confirm-overlay" onClick={() => setInvOpen(false)} role="dialog" aria-modal="true" aria-label="Warehouse inventory">
          <div className="confirm-box" style={{ width: 760 }} onClick={(e) => e.stopPropagation()}>
            <div className="confirm-title">{invWarehouse?.name} — Inventory</div>
            <div className="confirm-msg text-start">
              {invLoading ? (
                <Skeleton type="table" rows={5} />
              ) : inventory.length === 0 ? (
                <EmptyState title="No inventory" sub="This warehouse has no stock recorded yet." />
              ) : (
                <div className="table-responsive" style={{ maxHeight: "50vh", overflow: "auto" }}>
                  <table className="table table-sm table-striped mb-0">
                    <thead>
                      <tr><th>Product</th><th>SKU</th><th>Quantity</th><th>Reserved</th><th>Available</th><th>Global</th></tr>
                    </thead>
                    <tbody>
                      {inventory.map((it) => (
                        <tr key={it.id}>
                          <td>{it.product_name || "—"}</td>
                          <td className="small">{it.sku || "—"}</td>
                          <td>{it.quantity}</td>
                          <td>{it.reserved || 0}</td>
                          <td className={Number(it.quantity) - Number(it.reserved || 0) > 0 ? "text-success" : "text-danger"}>
                            {Number(it.quantity) - Number(it.reserved || 0)}
                          </td>
                          <td className="small text-muted">{it.global_stock}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="confirm-actions">
              <button className="btn btn-light" onClick={() => setInvOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {transferOpen && (
        <div className="confirm-overlay" onClick={() => !saving && setTransferOpen(false)} role="dialog" aria-modal="true" aria-label="New transfer">
          <div className="confirm-box" style={{ width: 640 }} onClick={(e) => e.stopPropagation()}>
            <div className="confirm-title"><FiTruck className="me-1" />New Stock Transfer</div>
            <div className="confirm-msg text-start">
              <div className="row g-2 mb-3">
                <div className="col-6">
                  <label className="form-label small fw-bold">From Warehouse *</label>
                  <select className="form-select" value={transferForm.from_warehouse_id} disabled={saving} onChange={(e) => setTransferForm({ ...transferForm, from_warehouse_id: e.target.value })}>
                    <option value="">Select...</option>
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>{w.name} ({w.code})</option>
                    ))}
                  </select>
                </div>
                <div className="col-6">
                  <label className="form-label small fw-bold">To Warehouse *</label>
                  <select className="form-select" value={transferForm.to_warehouse_id} disabled={saving} onChange={(e) => setTransferForm({ ...transferForm, to_warehouse_id: e.target.value })}>
                    <option value="">Select...</option>
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>{w.name} ({w.code})</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="d-flex justify-content-between align-items-center mb-2">
                <label className="form-label small fw-bold mb-0">Items</label>
                <button className="btn btn-sm btn-outline-primary" disabled={saving} onClick={addTransferItem}><FiPlus /> Add Item</button>
              </div>
              {transferItems.map((item, i) => (
                <div className="row g-2 mb-2" key={i}>
                  <div className="col-7">
                    <select className="form-select" value={item.product_id} disabled={saving} onChange={(e) => updateTransferItem(i, "product_id", e.target.value)}>
                      <option value="">Select product...</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>{p.name} ({p.sku || "no SKU"})</option>
                      ))}
                    </select>
                  </div>
                  <div className="col-3">
                    <input className="form-control" type="number" min="1" value={item.quantity} disabled={saving} onChange={(e) => updateTransferItem(i, "quantity", e.target.value)} />
                  </div>
                  <div className="col-2">
                    <button className="btn btn-outline-danger w-100" disabled={saving || transferItems.length === 1} onClick={() => removeTransferItem(i)}>×</button>
                  </div>
                </div>
              ))}
              <label className="form-label small fw-bold mt-2">Note</label>
              <input className="form-control" value={transferForm.note} disabled={saving} onChange={(e) => setTransferForm({ ...transferForm, note: e.target.value })} placeholder="Optional note for this transfer..." />
            </div>
            <div className="confirm-actions">
              <button className="btn btn-light" disabled={saving} onClick={() => setTransferOpen(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={saving} onClick={submitTransfer}>{saving ? "Creating..." : "Create Transfer"}</button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={deleteOpen}
        title="Deactivate Warehouse"
        message={`Are you sure you want to deactivate "${deleteTarget?.name}"? Its status will be set to inactive.`}
        confirmLabel="Deactivate"
        danger
        onConfirm={confirmDelete}
        onCancel={() => setDeleteOpen(false)}
      />
    </div>
  );
}