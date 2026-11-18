import React, { useEffect, useState, useRef } from "react";
import api from "../lib/api";
import { formatINR, formatDate } from "../lib/utils";
import { Skeleton, EmptyState, useToast } from "./ui";
import { FiCamera, FiSearch, FiPackage, FiGrid } from "react-icons/fi";
import { Html5Qrcode } from "html5-qrcode";

export default function AdminBarcode() {
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastSearched, setLastSearched] = useState("");

  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const scannerRef = useRef(null);

  const [setOpen, setSetOpen] = useState(false);
  const [setProduct, setSetProduct] = useState(null);
  const [setBarcode, setSetBarcode] = useState("");
  const [saving, setSaving] = useState(false);

  const doSearch = async (q) => {
    const term = (q ?? query).trim();
    if (!term) { toast.error("Enter a barcode, SKU or product name"); return; }
    setLoading(true);
    setError("");
    try {
      const res = await api.get("/barcode/search", { params: { q: term } });
      setResults(Array.isArray(res.data) ? res.data : []);
      setLastSearched(term);
    } catch (err) {
      setError(err.response?.data?.error || "Search failed");
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const stopScan = async () => {
    const inst = scannerRef.current;
    if (inst) {
      try {
        await inst.stop();
      } catch (e) {
        console.error("Stop scanner error:", e);
      }
      try {
        inst.clear();
      } catch (e) {
        console.error("Clear scanner error:", e);
      }
      scannerRef.current = null;
    }
    setScanning(false);
  };

  const startScan = async () => {
    setCameraError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("Camera API is not available in this browser. Please use the manual search field below.");
      return;
    }
    let inst;
    try {
      inst = new Html5Qrcode("scanner-region");
      await inst.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          setQuery(decodedText);
          doSearch(decodedText);
          stopScan();
        },
        () => {}
      );
      scannerRef.current = inst;
      setScanning(true);
    } catch (err) {
      setCameraError("Could not start the camera. Most test environments do not expose a camera. Please use the manual search field below to look up products by barcode, SKU or name.");
      if (inst) {
        try { inst.clear(); } catch (e) { console.error(e); }
      }
    }
  };

  useEffect(() => {
    return () => {
      const inst = scannerRef.current;
      if (inst) {
        inst.stop().catch(() => {});
      }
    };
  }, []);

  const openSetBarcode = (p) => {
    setSetProduct(p);
    setSetBarcode(p.barcode || "");
    setSetOpen(true);
  };

  const submitSetBarcode = async () => {
    const barcode = setBarcode.trim();
    if (!barcode) { toast.error("Barcode is required"); return; }
    setSaving(true);
    try {
      await api.post("/barcode/set-barcode", { productId: setProduct.id, barcode });
      toast.success("Barcode updated successfully");
      setSetOpen(false);
      doSearch(lastSearched || setProduct.barcode || setProduct.sku || setProduct.name);
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to set barcode");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="container-fluid py-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h2 className="mb-0"><FiGrid className="me-2" />Barcode Management</h2>
        <button className="btn btn-outline-secondary" onClick={() => { setResults([]); setQuery(""); setLastSearched(""); }}>Clear</button>
      </div>

      <div className="card p-3 mb-4">
        <div className="row g-3 align-items-center">
          <div className="col-md-8">
            <div className="input-group">
              <span className="input-group-text"><FiSearch /></span>
              <input
                className="form-control"
                placeholder="Enter barcode, SKU or product name (e.g. 8901234567890)"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") doSearch(); }}
                disabled={loading}
              />
              <button className="btn btn-primary" disabled={loading || !query.trim()} onClick={() => doSearch()}>
                {loading ? "Searching..." : "Search"}
              </button>
            </div>
            <div className="text-muted small mt-2">Manual entry is the reliable path — scans may not work on machines without a camera.</div>
          </div>
          <div className="col-md-4 text-md-end">
            {scanning ? (
              <button className="btn btn-outline-danger" onClick={stopScan}>Stop Scan</button>
            ) : (
              <button className="btn btn-outline-primary" onClick={startScan} disabled={loading} title="Start camera scanner">
                <FiCamera className="me-1" />Start Scanner
              </button>
            )}
          </div>
        </div>

        {cameraError && <div className="alert alert-warning mt-3 mb-0">{cameraError}</div>}
        {scanning && <div id="scanner-region" className="mt-3" style={{ maxWidth: 480 }} />}
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      {loading ? (
        <Skeleton type="card" rows={6} />
      ) : (
        <>
          {results.length === 0 && lastSearched && (
            <div className="card"><EmptyState icon={<FiPackage />} title="No products found" sub={`No product matched "${lastSearched}". Try a full barcode, exact SKU, or different name.`} /></div>
          )}
          {results.length === 0 && !lastSearched && !loading && (
            <div className="card"><EmptyState icon={<FiPackage />} title="Search to begin" sub="Look up products by barcode, SKU or name, then assign barcodes where missing." /></div>
          )}
          {results.map((p) => (
            <div className="card shadow-sm mb-3" key={p.id}>
              <div className="card-body">
                <div className="row g-3">
                  <div className="col-lg-7">
                    <div className="d-flex justify-content-between align-items-start">
                      <div>
                        <div className="d-flex gap-2 align-items-center mb-1">
                          <h6 className="mb-0">{p.name}</h6>
                          {p.category && <span className="badge bg-secondary">{p.category}</span>}
                          {p.brand && <span className="badge bg-light text-dark">{p.brand}</span>}
                        </div>
                        <div className="text-muted small mb-2">
                          SKU: <strong>{p.sku || "—"}</strong> · Barcode: <strong>{p.barcode || "Not assigned"}</strong>
                        </div>
                        <div className="d-flex flex-wrap gap-3 small">
                          <span>Price: <strong>{formatINR(p.price)}</strong></span>
                          <span>MRP: <strong>{formatINR(p.mrp)}</strong></span>
                          <span>Purchase: <strong>{formatINR(p.purchase_price)}</strong></span>
                          <span className={Number(p.stock) <= 0 ? "text-danger fw-bold" : ""}>Stock: <strong>{p.stock}</strong></span>
                          {p.expiry_date && <span className="text-muted">Expiry: {formatDate(p.expiry_date)}</span>}
                        </div>
                      </div>
                      <button className="btn btn-sm btn-outline-primary" onClick={() => openSetBarcode(p)}>
                        {p.barcode ? "Edit Barcode" : "Assign Barcode"}
                      </button>
                    </div>
                  </div>
                  <div className="col-lg-5">
                    <div className="table-responsive">
                      <table className="table table-sm table-striped mb-0">
                        <thead>
                          <tr><th colSpan="2" className="text-muted small">Warehouse Stock</th></tr>
                        </thead>
                        <tbody>
                          {p.warehouseStock && p.warehouseStock.length > 0 ? (
                            p.warehouseStock.map((w, i) => (
                              <tr key={i}>
                                <td>{w.warehouse}</td>
                                <td className="text-end fw-bold">{w.quantity}</td>
                              </tr>
                            ))
                          ) : (
                            <tr><td className="text-muted">No warehouse stock</td><td></td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </>
      )}

      {setOpen && (
        <div className="confirm-overlay" onClick={() => !saving && setSetOpen(false)} role="dialog" aria-modal="true" aria-label="Set barcode">
          <div className="confirm-box" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-title">Set Barcode</div>
            <div className="confirm-msg text-start">
              <label className="form-label small fw-bold">Product</label>
              <input className="form-control mb-3" value={setProduct ? `${setProduct.name} (${setProduct.sku || "no SKU"})` : ""} disabled readOnly />
              <label className="form-label small fw-bold">Barcode</label>
              <input className="form-control" value={setBarcode} disabled={saving} onChange={(e) => setSetBarcode(e.target.value)} placeholder="Enter the barcode value" onKeyDown={(e) => { if (e.key === "Enter") submitSetBarcode(); }} />
            </div>
            <div className="confirm-actions">
              <button className="btn btn-light" disabled={saving} onClick={() => setSetOpen(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={saving} onClick={submitSetBarcode}>{saving ? "Saving..." : "Save Barcode"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}