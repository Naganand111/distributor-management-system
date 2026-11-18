import React, { useEffect, useState, useRef, useMemo } from "react";
import { Outlet, NavLink, useNavigate, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import {
  FiHome,
  FiShoppingBag,
  FiShoppingCart,
  FiClipboard,
  FiFileText,
  FiCreditCard,
  FiUser,
  FiLogOut,
  FiBell,
  FiSun,
  FiMoon,
  FiZap,
  FiMenu,
  FiSearch,
} from "react-icons/fi";
import { clearAuth, getCart, getUser } from "../lib/auth";
import { getCartQty } from "../lib/utils";
import api from "../lib/api";
import useTheme from "../lib/theme";
import NotificationBell from "./NotificationBell";
import { ConfirmModal } from "./ui";

const NAV = [
  { to: "/customer-dashboard", icon: FiHome, label: "Dashboard" },
  { to: "/shop", icon: FiShoppingBag, label: "Shop" },
  { to: "/cart", icon: FiShoppingCart, label: "My Cart", cart: true },
  { to: "/my-orders", icon: FiClipboard, label: "My Orders" },
  { to: "/my-invoices", icon: FiFileText, label: "Invoices" },
  { to: "/my-payments", icon: FiCreditCard, label: "Payments" },
  { to: "/notifications", icon: FiBell, label: "Notifications" },
  { to: "/profile", icon: FiUser, label: "Profile" },
];

export default function CustomerLayout() {
  const [cartCount, setCartCount] = useState(0);
  const [user, setUser] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, toggle } = useTheme();
  const profileRef = useRef(null);

  const refreshCart = () => setCartCount(getCartQty(getCart()));

  useEffect(() => {
    refreshCart();
    setUser(getUser());
    window.addEventListener("cartUpdated", refreshCart);
    return () => window.removeEventListener("cartUpdated", refreshCart);
  }, []);

  useEffect(() => {
    setSidebarOpen(false);
    setProfileOpen(false);
    setSearchOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const onClick = (e) => {
      if (profileRef.current && !profileRef.current.contains(e.target)) setProfileOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const handleLogout = async () => {
    try { await api.post("/auth/logout"); } catch { /* ignore */ }
    clearAuth();
    window.dispatchEvent(new Event("cartUpdated"));
    navigate("/login");
  };

  const currentLabel = useMemo(() => {
    const match = NAV.find((i) => i.to === location.pathname);
    return match ? match.label : "Customer";
  }, [location.pathname]);

  const linkClass = ({ isActive }) =>
    `cust-link ${isActive ? "active" : ""}`;

  const sidebarNav = (
    <nav className="cust-nav">
      {NAV.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink
            key={item.to}
            to={item.to}
            className={linkClass}
            onClick={() => setSidebarOpen(false)}
          >
            <Icon className="cust-link-icon" />
            <span className="cust-link-label">{item.label}</span>
            {item.cart && cartCount > 0 && (
              <span className="cust-nav-badge">{cartCount}</span>
            )}
          </NavLink>
        );
      })}

      <button className="cust-link cust-logout" onClick={() => setConfirmLogout(true)}>
        <FiLogOut className="cust-link-icon" />
        <span className="cust-link-label">Logout</span>
      </button>
    </nav>
  );

  return (
    <div className="cust-layout">
      {/* OVERLAY for mobile drawer */}
      {sidebarOpen && <div className="cust-overlay" onClick={() => setSidebarOpen(false)} />}

      {/* SIDEBAR (desktop) */}
      <aside className="cust-sidebar">
        <div className="cust-brand">
          <div className="cust-brand-logo"><FiZap /></div>
          <div className="cust-brand-text">
            <strong>DMS</strong>
            <span>Customer Portal</span>
          </div>
        </div>
        <div className="cust-sidebar-scroll">{sidebarNav}</div>
      </aside>

      {/* SIDEBAR (mobile drawer) */}
      <aside className={`cust-sidebar cust-drawer ${sidebarOpen ? "open" : ""}`}>
        <div className="cust-brand">
          <div className="cust-brand-logo"><FiZap /></div>
          <div className="cust-brand-text">
            <strong>DMS</strong>
            <span>Customer Portal</span>
          </div>
        </div>
        <div className="cust-sidebar-scroll">{sidebarNav}</div>
      </aside>

      {/* MAIN */}
      <div className="cust-main">
        {/* HEADER */}
        <header className="cust-header">
          <div className="cust-header-left">
            <button
              className="icon-btn cust-mobile-menu"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open menu"
            >
              <FiMenu />
            </button>
            <div className="cust-breadcrumb">
              <span className="cust-breadcrumb-root">Portal</span>
              <span className="cust-breadcrumb-sep">/</span>
              <span className="cust-breadcrumb-current">{currentLabel}</span>
              <h1 className="cust-page-title">{currentLabel}</h1>
            </div>
          </div>

          <div className="cust-header-right">
            <button className="icon-btn" onClick={() => setSearchOpen(true)} aria-label="Open search">
              <FiSearch />
            </button>
            <NotificationBell />
            <button className="icon-btn" onClick={toggle} aria-label="Toggle theme">
              {theme === "dark" ? <FiSun /> : <FiMoon />}
            </button>

            {/* Cart quick link */}
            <NavLink to="/cart" className="icon-btn cust-cart-link" aria-label="Cart">
              <FiShoppingCart />
              {cartCount > 0 && <span className="notif-count">{cartCount}</span>}
            </NavLink>

            {/* Profile dropdown */}
            <div className="cust-profile" ref={profileRef}>
              <button className="cust-profile-btn" onClick={() => setProfileOpen(!profileOpen)} aria-label="Account">
                <span className="cust-avatar">{(user?.name || "U").charAt(0).toUpperCase()}</span>
                <span className="cust-profile-meta">
                  <span className="cust-profile-name">{user?.name || "Customer"}</span>
                  <span className="cust-profile-role">{user?.role || ""}</span>
                </span>
              </button>
              {profileOpen && (
                <div className="header-dropdown">
                  <div className="dd-header">
                    <div className="dd-name">{user?.name || "Customer"}</div>
                    <div className="dd-role">{user?.role || ""}</div>
                  </div>
                  <button className="dd-item" onClick={() => { setProfileOpen(false); navigate("/profile"); }}>
                    <FiUser /> Profile
                  </button>
                  <button className="dd-item" onClick={() => { setProfileOpen(false); navigate("/my-orders"); }}>
                    <FiClipboard /> My Orders
                  </button>
                  <button className="dd-item danger" onClick={() => { setProfileOpen(false); setConfirmLogout(true); }}>
                    <FiLogOut /> Logout
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* CONTENT */}
        <main className="cust-content">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          >
            <Outlet />
          </motion.div>
        </main>
      </div>

      {/* Mobile search overlay: navigates to /shop (command palette reserved for admin) */}
      {searchOpen && (
        <div className="cust-search-overlay" onClick={() => setSearchOpen(false)}>
          <div className="cust-search-box" onClick={(e) => e.stopPropagation()}>
            <h4>Search Products</h4>
            <p className="cust-search-sub">Head to the shop to browse and search products.</p>
            <div className="d-flex gap-2">
              <button className="btn btn-primary" onClick={() => { setSearchOpen(false); navigate("/shop"); }}>Go to Shop</button>
              <button className="btn btn-light" onClick={() => setSearchOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={confirmLogout}
        title="Log out?"
        message="You will be signed out of your account."
        confirmLabel="Log out"
        danger
        onConfirm={handleLogout}
        onCancel={() => setConfirmLogout(false)}
      />

      <style>{`
        .cust-layout { display:flex; min-height:100vh; background: var(--bg); }
        .cust-main { flex:1; display:flex; flex-direction:column; min-width:0; }

        /* ===== SIDEBAR ===== */
        .cust-sidebar {
          width: var(--sidebar-w); background: var(--surface);
          border-right: 1px solid var(--border);
          display:flex; flex-direction:column; flex-shrink:0;
          position: sticky; top:0; height:100vh; z-index:60;
          transition: transform .25s ease;
        }
        .cust-brand { display:flex; align-items:center; gap:10px; padding:18px 16px; border-bottom:1px solid var(--border); }
        .cust-brand-logo {
          width:36px; height:36px; flex-shrink:0; border-radius:10px;
          background: linear-gradient(135deg, var(--brand), var(--brand-strong));
          color:#fff; display:flex; align-items:center; justify-content:center; font-size:19px;
        }
        .cust-brand-text strong { display:block; font-size:16px; line-height:1; color:var(--text); }
        .cust-brand-text span { font-size:11px; color:var(--text-muted); }
        .cust-sidebar-scroll { flex:1; overflow-y:auto; overflow-x:hidden; padding:12px; }
        .cust-nav { display:flex; flex-direction:column; gap:4px; }
        .cust-link {
          display:flex; align-items:center; gap:12px; padding:11px 12px;
          border-radius:8px; text-decoration:none; color:var(--text-secondary);
          font-size:14px; font-weight:500;
          border:none; background:transparent; width:100%; cursor:pointer; text-align:left;
          position:relative; transition: background .15s, color .15s;
        }
        .cust-link:hover { background: var(--surface-hover); color: var(--text); }
        .cust-link.active { background: var(--brand-soft); color: var(--brand); font-weight:600; }
        .cust-link.active::before {
          content:""; position:absolute; left:-12px; top:50%; transform:translateY(-50%);
          width:3px; height:22px; border-radius:3px; background: var(--brand);
        }
        .cust-link-icon { font-size:18px; flex-shrink:0; }
        .cust-link-label { flex:1; }
        .cust-nav-badge {
          background: var(--danger); color:#fff; border-radius:999px; font-size:11px;
          padding:1px 7px; min-width:20px; text-align:center;
        }
        .cust-logout { margin-top:16px; color: var(--danger); }
        .cust-logout:hover { background: var(--danger-bg); color: var(--danger); }

        /* ===== HEADER ===== */
        .cust-header {
          height: var(--header-h);
          background: var(--surface);
          border-bottom: 1px solid var(--border);
          display:flex; align-items:center; justify-content:space-between;
          padding:0 var(--content-pad);
          position: sticky; top:0; z-index:50; gap:16px;
        }
        .cust-header-left { display:flex; align-items:center; gap:14px; min-width:0; }
        .cust-mobile-menu { display:none; }
        .cust-breadcrumb { display:flex; flex-direction:column; min-width:0; }
        .cust-breadcrumb-root { font-size:12px; color:var(--text-muted); }
        .cust-breadcrumb-sep { color:var(--text-muted); margin:0 4px; }
        .cust-breadcrumb-current { display:none; }
        .cust-page-title { font-size:17px; font-weight:700; margin:0; color:var(--text); line-height:1.2; }
        .cust-header-right { display:flex; align-items:center; gap:10px; position:relative; }
        .cust-cart-link { text-decoration:none; }

        .cust-profile { position:relative; }
        .cust-profile-btn {
          display:flex; align-items:center; gap:10px; background:none; border:none; cursor:pointer;
          padding:4px; border-radius:8px;
        }
        .cust-profile-btn:hover { background: var(--surface-hover); }
        .cust-avatar {
          width:36px; height:36px; border-radius:50%;
          background:linear-gradient(135deg, var(--brand), var(--brand-strong));
          color:#fff; display:flex; align-items:center; justify-content:center; font-weight:700;
        }
        .cust-profile-meta { display:flex; flex-direction:column; text-align:left; line-height:1.2; }
        .cust-profile-name { font-weight:600; font-size:13.5px; color:var(--text); }
        .cust-profile-role { font-size:11px; color:var(--text-muted); text-transform:capitalize; }

        .cust-content { padding: var(--content-pad); flex:1; }
        .cust-overlay { display:none; }

        /* ===== SEARCH OVERLAY ===== */
        .cust-search-overlay {
          position:fixed; inset:0; background:rgba(10,14,20,.5); z-index:1700;
          display:flex; align-items:center; justify-content:center; padding:20px;
          animation: fade-in .15s ease;
        }
        .cust-search-box {
          background: var(--surface); color: var(--text);
          border:1px solid var(--border); border-radius: var(--radius-lg);
          padding:26px; width:100%; max-width:420px; box-shadow: var(--shadow-lg);
          animation: pop-in .18s cubic-bezier(.21,1.02,.73,1);
        }
        .cust-search-sub { color: var(--text-secondary); font-size:14px; margin-bottom:20px; }

        /* ===== MOBILE DRAWER ===== */
        .cust-drawer { display:none; }

        @media (max-width: 900px) {
          .cust-sidebar { display:none; }
          .cust-sidebar.cust-drawer {
            display:flex; position:fixed; left:0; top:0; transform:translateX(-100%);
            width: var(--sidebar-w); box-shadow: var(--shadow-lg);
          }
          .cust-sidebar.cust-drawer.open { transform:translateX(0); }
          .cust-overlay {
            display:block; position:fixed; inset:0; background:rgba(10,14,20,.5); z-index:55;
          }
          .cust-mobile-menu { display:inline-flex; }
        }
        @media (max-width: 1024px) {
          .cust-profile-meta { display:none; }
        }
        @media (max-width: 640px) {
          .cust-content { padding:16px; }
          .cust-header { padding:0 14px; }
        }
      `}</style>
    </div>
  );
}
