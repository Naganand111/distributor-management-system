import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FiSearch, FiX } from "react-icons/fi";
import api from "../lib/api";
import { getCart, setCart } from "../lib/auth";
import { formatINR, getImageSrc } from "../lib/utils";

export default function Shop() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [brand, setBrand] = useState("all");
  const [priceRange, setPriceRange] = useState("all");
  const [availability, setAvailability] = useState("all");
  const [sort, setSort] = useState("default");

  const navigate = useNavigate();

  useEffect(() => {
    api
      .get("/products?active=1&inStock=1")
      .then((res) => setProducts(Array.isArray(res.data.data) ? res.data.data : []))
      .catch(() => setError("Failed to load products"))
      .finally(() => setLoading(false));
  }, []);

  /* Derive filter options from the fetched products (no admin endpoints). */
  const categories = useMemo(
    () => [...new Set(products.map((p) => p.category || "Other"))].sort(),
    [products]
  );
  const brands = useMemo(
    () => [...new Set(products.map((p) => p.brand || "Other"))].sort(),
    [products]
  );

  const filtered = useMemo(() => {
    let list = products.filter((p) => {
      if (category !== "all" && (p.category || "Other") !== category) return false;
      if (brand !== "all" && (p.brand || "Other") !== brand) return false;
      const price = Number(p.price) || 0;
      if (priceRange === "0-500" && !(price <= 500)) return false;
      if (priceRange === "500-1000" && !(price > 500 && price <= 1000)) return false;
      if (priceRange === "1000-2000" && !(price > 1000 && price <= 2000)) return false;
      if (priceRange === "2000+" && !(price > 2000)) return false;
      if (availability === "inStock" && !(p.stock > 0)) return false;
      return true;
    });

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.sku || "").toLowerCase().includes(q) ||
          (p.category || "").toLowerCase().includes(q) ||
          (p.brand || "").toLowerCase().includes(q)
      );
    }

    switch (sort) {
      case "name-asc": list = [...list].sort((a, b) => a.name.localeCompare(b.name)); break;
      case "name-desc": list = [...list].sort((a, b) => b.name.localeCompare(a.name)); break;
      case "price-low": list = [...list].sort((a, b) => Number(a.price) - Number(b.price)); break;
      case "price-high": list = [...list].sort((a, b) => Number(b.price) - Number(a.price)); break;
      default: break;
    }
    return list;
  }, [products, search, category, brand, priceRange, availability, sort]);

  const addToCart = (prod) => {
    const cart = getCart() || [];
    const existing = cart.find((i) => i.id === prod.id);
    if (existing) {
      existing.quantity += 1;
    } else {
      cart.push({ id: prod.id, name: prod.name, price: Number(prod.price), quantity: 1, image: prod.image || "", sku: prod.sku || "" });
    }
    setCart(cart);
    window.dispatchEvent(new Event("cartUpdated"));
    navigate(`/shop/product/${prod.id}`);
  };

  const filtersActive =
    search.trim() !== "" ||
    category !== "all" ||
    brand !== "all" ||
    priceRange !== "all" ||
    availability !== "all" ||
    sort !== "default";

  const clearFilters = () => {
    setSearch(""); setCategory("all"); setBrand("all"); setPriceRange("all"); setAvailability("all"); setSort("default");
  };

  return (
    <div>
      <div className="d-flex justify-content-between align-items-center flex-wrap mb-3">
        <div>
          <h3 className="cust-page-title mb-0">Shop</h3>
          <p className="text-muted mb-0">Browse our products</p>
        </div>
      </div>

      {/* FILTERS / SEARCH / SORT */}
      <div className="filter-toolbar">
        <div className="filter-search">
          <span className="filter-search-ico"><FiSearch /></span>
          <input
            className="form-control filter-search-input"
            placeholder="Search products…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select className="form-select filter-select" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="all">Category</option>
          {categories.map((c) => <option value={c} key={c}>{c}</option>)}
        </select>
        <select className="form-select filter-select" value={brand} onChange={(e) => setBrand(e.target.value)}>
          <option value="all">Brand</option>
          {brands.map((b) => <option value={b} key={b}>{b}</option>)}
        </select>
        <select className="form-select filter-select" value={priceRange} onChange={(e) => setPriceRange(e.target.value)}>
          <option value="all">Price</option>
          <option value="0-500">Up to ₹500</option>
          <option value="500-1000">₹500 - 1000</option>
          <option value="1000-2000">₹1000 - 2000</option>
          <option value="2000+">Above ₹2000</option>
        </select>
        <select className="form-select filter-select" value={availability} onChange={(e) => setAvailability(e.target.value)}>
          <option value="all">Availability</option>
          <option value="inStock">In Stock</option>
        </select>
        <select className="form-select filter-select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort products">
          <option value="default">Sort</option>
          <option value="name-asc">Name A-Z</option>
          <option value="name-desc">Name Z-A</option>
          <option value="price-low">Price: Low to High</option>
          <option value="price-high">Price: High to Low</option>
        </select>
        {filtersActive && (
          <button className="filter-clear" onClick={clearFilters} type="button" aria-label="Clear all filters">
            <FiX /> Clear
          </button>
        )}
      </div>

      {/* PRODUCTS */}
      {loading ? (
        <PendingGrid />
      ) : error ? (
        <div className="alert alert-danger">{error}</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-5 text-muted">
          <p><strong>No products found.</strong></p>
          <button className="btn btn-outline-primary" onClick={clearFilters}>Clear filters</button>
        </div>
      ) : (
        <div className="shop-grid">
          {filtered.map((p) => (
            <div key={p.id} className="card shadow-sm shop-card">
              <Link to={`/shop/product/${p.id}`} className="shop-img-link">
                <div className="shop-img">
                  <img src={getImageSrc(p.image)} alt={p.name} onError={(e) => (e.target.src = "/no-image.png")} loading="lazy" />
                  {p.stock <= 0 && <span className="badge bg-danger sho-badge">Out of stock</span>}
                  {p.stock > 0 && p.stock <= 5 && <span className="badge bg-warning sho-badge sho-badge-right">Low</span>}
                  <div className="shop-img-shine" />
                </div>
              </Link>
              <div className="shop-body">
                <div className="shop-brand">{p.brand || "General"}</div>
                <Link to={`/shop/product/${p.id}`} className="shop-name">{p.name}</Link>
                <div className="shop-sku">{p.sku ? `SKU: ${p.sku}` : ""}</div>
                <div className="shop-category text-muted small">{p.category || ""}</div>
                <div className="shop-price-row">
                  <span className="shop-price">{formatINR(p.price)}</span>
                  {Number(p.mrp) > Number(p.price) && (
                    <span className="shop-mrp">{formatINR(p.mrp)}</span>
                  )}
                </div>
                <button
                  className="sho-add"
                  disabled={p.stock <= 0}
                  onClick={() => addToCart(p)}
                >
                  {p.stock > 0 ? "Add to Cart" : "Out of Stock"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <style>{`
        .shop-grid {
          display:grid;
          grid-template-columns: repeat(4, 1fr);
          gap:20px;
        }
        .shop-card {
          display:flex; flex-direction:column;
          border:1px solid var(--border); border-radius:18px; overflow:hidden;
          background: var(--surface);
          transition: transform .3s ease, box-shadow .3s ease, border-color .3s ease;
        }
        .shop-card:hover { transform: translateY(-6px); box-shadow: var(--shadow-lg); border-color: var(--glow-brand); }
        .shop-img-link { display:block; }
        .shop-img {
          aspect-ratio: 4/3; width:100%;
          background: linear-gradient(135deg, var(--surface-2), var(--bg-alt));
          position:relative; overflow:hidden;
        }
        .shop-img img {
          width:100%; height:100%; object-fit:contain;
          padding:10px;
          transition: transform .4s cubic-bezier(.16,1,.3,1);
        }
        .shop-card:hover .shop-img img { transform: scale(1.05); }
        .shop-img-shine {
          position:absolute; inset:0; pointer-events:none;
          background: linear-gradient(110deg, transparent 30%, rgba(255,255,255,.12) 50%, transparent 70%);
          transform: translateX(-120%); transition: transform .7s ease;
        }
        .shop-card:hover .shop-img-shine { transform: translateX(120%); }
        .sho-badge { position:absolute; top:12px; left:12px; z-index:2; font-weight:700; }
        .sho-badge-right { right:12px; left:auto; }
        .shop-body { padding:14px 16px 16px; display:flex; flex-direction:column; flex:1; }
        .shop-brand { font-size:11px; text-transform:uppercase; letter-spacing:.6px; color:var(--text-muted); }
        .shop-name { display:block; font-weight:600; color:var(--text); text-decoration:none; margin:3px 0; transition:color .2s; }
        .shop-name:hover { color: var(--brand); }
        .shop-sku { font-size:12px; color:var(--text-muted); }
        .shop-price-row { display:flex; align-items:baseline; gap:8px; margin:6px 0 12px; }
        .shop-price { font-size:18px; font-weight:800; color:var(--text); }
        .shop-mrp { font-size:12px; color:var(--text-muted); text-decoration:line-through; }
        .sho-add {
          width:100%; border:none; border-radius:999px; padding:9px 14px; margin-top:auto;
          font-weight:700; font-size:13.5px; cursor:pointer;
          background: var(--grad-brand); color:#fff;
          box-shadow: 0 8px 20px -8px var(--glow-brand);
          transition: box-shadow .2s ease, transform .15s ease, filter .2s ease;
        }
        .sho-add:hover:not(:disabled) { box-shadow: 0 12px 26px -8px var(--glow-brand); filter:brightness(1.06); transform:translateY(-1px); }
        .sho-add:active:not(:disabled) { transform: scale(.97); }
        .sho-add:disabled { background: var(--surface-2); color: var(--text-muted); cursor:not-allowed; box-shadow:none; }

        /* COMPACT FILTER TOOLBAR */
        .filter-toolbar {
          display:flex; align-items:center; flex-wrap:wrap; gap:10px;
          background: var(--surface); border:1px solid var(--border);
          border-radius: var(--radius-lg); padding:12px 14px; margin-bottom:20px;
          box-shadow: var(--shadow);
        }
        .filter-search { position:relative; flex:1 1 240px; min-width:180px; }
        .filter-search-ico { position:absolute; left:12px; top:50%; transform:translateY(-50%); color:var(--text-muted); display:inline-flex; }
        .filter-search-input { padding-left:34px; width:100%; }
        .filter-search-input::placeholder { color: var(--text-muted); }
        .filter-select { flex:0 1 auto; min-width:130px; }
        .filter-clear {
          display:inline-flex; align-items:center; gap:4px;
          border:1px solid var(--border); background:var(--surface-2); color:var(--text-secondary);
          border-radius:var(--radius-sm); padding:8px 14px; font-weight:600; font-size:13.5px; cursor:pointer;
          transition: background .15s, color .15s, border-color .15s;
        }
        .filter-clear:hover { background:var(--danger-bg); color:var(--danger); border-color:transparent; }

        @media (max-width: 1200px) { .shop-grid { grid-template-columns: repeat(3, 1fr); } }
        @media (max-width: 992px)  { .shop-grid { grid-template-columns: repeat(2, 1fr); } }
        @media (max-width: 576px)  { .shop-grid { grid-template-columns: repeat(1, 1fr); } .filter-toolbar { gap:8px; } .filter-search { flex-basis:100%; } }
      `}</style>
    </div>
  );
}

function PendingGrid() {
  return (
    <div className="shop-grid">
      {[...Array(8)].map((_, i) => (
        <div key={i} className="card shop-card" style={{ aspectRatio: "4/3", borderRadius: 18, background: "var(--surface-2)" }}></div>
      ))}
    </div>
  );
}
