import React, { useEffect, useState, useMemo, useRef } from "react";
import { Outlet, NavLink, useNavigate, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import {
  FiHome, FiTrendingUp, FiBox, FiTag, FiStar, FiArchive,
  FiArrowDownCircle, FiActivity, FiAlertTriangle, FiShoppingCart,
  FiUsers, FiAward, FiMapPin, FiTruck, FiShoppingBag,
  FiCreditCard, FiFileText, FiRotateCcw, FiAlertOctagon, FiSearch,
  FiBell, FiLogOut, FiUser, FiMenu, FiSun, FiMoon, FiZap,
  FiBarChart, FiCpu, FiGift, FiDollarSign, FiPackage, FiGrid,
  FiNavigation, FiShield, FiCheckCircle,
} from "react-icons/fi";
import api from "../lib/api";
import useTheme from "../lib/theme";
import { clearAuth, getUser } from "../lib/auth";
import CommandPalette from "./ui/CommandPalette";
import NotificationBell from "./NotificationBell";
import { ConfirmModal } from "./ui";

/* Sidebar navigation definition (grouped). */
const NAV = [
  {
    label: "Overview",
    items: [
      { to: "/admin/dashboard", icon: FiHome, label: "Dashboard" },
      { to: "/admin/analytics", icon: FiTrendingUp, label: "Analytics" },
      { to: "/admin/assistant", icon: FiCpu, label: "AI Assistant" },
    ],
  },
  {
    label: "Catalog",
    items: [
      { to: "/admin/products", icon: FiBox, label: "Products" },
      { to: "/admin/categories", icon: FiTag, label: "Categories" },
      { to: "/admin/brands", icon: FiStar, label: "Brands" },
    ],
  },
  {
    label: "Inventory",
    items: [
      { to: "/admin/inventory", icon: FiArchive, label: "Inventory" },
      { to: "/admin/stock-in", icon: FiArrowDownCircle, label: "Stock In" },
      { to: "/admin/stock-history", icon: FiActivity, label: "Stock History" },
      { to: "/admin/low-stock", icon: FiAlertTriangle, label: "Low Stock" },
      { to: "/admin/reorder", icon: FiZap, label: "Smart Reorder" },
      { to: "/admin/warehouses", icon: FiPackage, label: "Warehouses" },
      { to: "/admin/barcode", icon: FiGrid, label: "Barcode / QR" },
    ],
  },
  {
    label: "Sales & Distribution",
    items: [
      { to: "/admin/sales-orders", icon: FiShoppingCart, label: "Sales Orders" },
      { to: "/admin/order-tracking", icon: FiActivity, label: "Order Tracking" },
      { to: "/admin/orders", icon: FiShoppingCart, label: "Customer Orders" },
      { to: "/admin/retailers", icon: FiUsers, label: "Retailers" },
      { to: "/admin/sales-management", icon: FiAward, label: "Sales Reps" },
      { to: "/admin/territories", icon: FiMapPin, label: "Territories" },
      { to: "/admin/routes", icon: FiNavigation, label: "Sales Routes" },
      { to: "/admin/visits", icon: FiCheckCircle, label: "Retailer Visits" },
      { to: "/admin/deliveries", icon: FiTruck, label: "Deliveries" },
    ],
  },
  {
    label: "Purchasing",
    items: [
      { to: "/admin/suppliers", icon: FiTruck, label: "Suppliers" },
      { to: "/admin/purchase-orders", icon: FiShoppingBag, label: "Purchase Orders" },
    ],
  },
  {
    label: "Finance",
    items: [
      { to: "/admin/billing", icon: FiCreditCard, label: "Billing" },
      { to: "/admin/invoices", icon: FiFileText, label: "Invoices" },
      { to: "/admin/payments", icon: FiCreditCard, label: "Payments" },
      { to: "/admin/profit", icon: FiTrendingUp, label: "Profit & Margins" },
      { to: "/admin/credit", icon: FiDollarSign, label: "Credit & Outstandings" },
      { to: "/admin/reports", icon: FiBarChart, label: "Reports" },
    ],
  },
  {
    label: "Marketing",
    items: [
      { to: "/admin/promotions", icon: FiGift, label: "Promotions" },
    ],
  },
  {
    label: "Operations",
    items: [
      { to: "/admin/returns", icon: FiRotateCcw, label: "Returns" },
      { to: "/admin/damaged-expired", icon: FiAlertOctagon, label: "Damaged / Expired" },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { to: "/admin/global-search", icon: FiSearch, label: "Search & Docs" },
    ],
  },
  {
    label: "System",
    items: [
      { to: "/admin/security", icon: FiShield, label: "Security Center" },
      { to: "/admin/loyalty", icon: FiAward, label: "Loyalty" },
      { to: "/admin/companies", icon: FiHome, label: "Companies & Branches" },
      { to: "/admin/notifications", icon: FiBell, label: "Notifications" },
      { to: "/admin/activity-logs", icon: FiActivity, label: "Activity Logs" },
      { to: "/admin/users", icon: FiUsers, label: "Users" },
    ],
  },
];

export default function AdminLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [user, setUser] = useState(null);
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, toggle } = useTheme();
  const profileRef = useRef(null);

  useEffect(() => { setUser(getUser()); }, []);
  useEffect(() => { setDrawerOpen(false); setProfileOpen(false); }, [location.pathname]);

  /* Close profile dropdown on outside click */
  useEffect(() => {
    const onClick = (e) => { if (profileRef.current && !profileRef.current.contains(e.target)) setProfileOpen(false); };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  /* Global '/' command palette shortcut */
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "/") {
        const tag = (e.target.tagName || "").toLowerCase();
        if (tag !== "input" && tag !== "textarea") { e.preventDefault(); setPaletteOpen(true); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const currentLabel = useMemo(() => {
    for (const group of NAV) {
      const match = group.items.find((i) => i.to === location.pathname);
      if (match) return match.label;
    }
    return "Dashboard";
  }, [location.pathname]);

  const handleLogout = async () => {
    try { await api.post("/auth/logout"); } catch { /* ignore */ }
    clearAuth();
    navigate("/login");
  };

  const linkClass = ({ isActive }) =>
    `admin-link ${isActive ? "active" : ""}`;

  const sidebarNav = (
    <nav className="admin-nav">
      {NAV.map((group) => (
        <div key={group.label} className="admin-nav-group">
          {!collapsed && <div className="admin-nav-label">{group.label}</div>}
          {group.items.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={linkClass}
                title={collapsed ? item.label : undefined}
                onClick={() => { setDrawerOpen(false); }}
              >
                <Icon className="admin-nav-icon" />
                {!collapsed && <span>{item.label}</span>}
              </NavLink>
            );
          })}
        </div>
      ))}
    </nav>
  );

  return (
    <div className={`admin-layout`}>
      {/* ============ SIDEBAR (desktop) ============ */}
      <aside className={`admin-sidebar ${collapsed ? "collapsed" : ""}`}>
        <div className="admin-brand">
          <div className="admin-brand-logo"><FiZap /></div>
          {!collapsed && <div className="admin-brand-text"><strong>DMS</strong><span>Enterprise</span></div>}
        </div>
        <div className="admin-sidebar-scroll">{sidebarNav}</div>
        <div className="admin-sidebar-foot">
          <button className="admin-collapse-btn" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
            <FiMenu />
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>
      </aside>

      {/* ============ MOBILE DRAWER ============ */}
      {drawerOpen && <div className="admin-overlay" onClick={() => setDrawerOpen(false)} />}
      <aside className={`admin-sidebar admin-drawer ${drawerOpen ? "open" : ""}`}>
        <div className="admin-brand">
          <div className="admin-brand-logo"><FiZap /></div>
          <div className="admin-brand-text"><strong>DMS</strong><span>Enterprise</span></div>
        </div>
        <div className="admin-sidebar-scroll">{sidebarNav}</div>
      </aside>

      {/* ============ MAIN ============ */}
      <div className="admin-main">
        {/* HEADER */}
        <header className="admin-header">
          <div className="admin-header-left">
            <button className="icon-btn admin-mobile-menu" onClick={() => setDrawerOpen(true)} aria-label="Open menu">
              <FiMenu />
            </button>
            <div className="admin-breadcrumb">
              <span className="admin-breadcrumb-root">Admin</span>
              <span className="admin-breadcrumb-sep">/</span>
              <span className="admin-breadcrumb-current">{currentLabel}</span>
              <h1 className="admin-page-title">{currentLabel}</h1>
            </div>
          </div>

          <div className="admin-header-right">
            <button className="icon-btn" onClick={() => setPaletteOpen(true)} aria-label="Open search ( / )">
              <FiSearch />
              <span className="admin-search-hint">/</span>
            </button>
            <NotificationBell />
            <button className="icon-btn" onClick={toggle} aria-label="Toggle theme">
              {theme === "dark" ? <FiSun /> : <FiMoon />}
            </button>

            {/* Profile dropdown */}
            <div className="admin-profile" ref={profileRef}>
              <button className="admin-profile-btn" onClick={() => setProfileOpen(!profileOpen)} aria-label="Account">
                <span className="admin-avatar">{(user?.name || "U").charAt(0).toUpperCase()}</span>
                {!collapsed && (
                  <span className="admin-profile-meta">
                    <span className="admin-profile-name">{user?.name || "Admin"}</span>
                    <span className="admin-profile-role">{user?.role || ""}</span>
                  </span>
                )}
              </button>
              {profileOpen && (
                <div className="header-dropdown">
                  <div className="dd-header">
                    <div className="dd-name">{user?.name || "Admin"}</div>
                    <div className="dd-role">{user?.role || ""}</div>
                  </div>
                  <button className="dd-item" onClick={() => { setProfileOpen(false); navigate("/admin/dashboard"); }}>
                    <FiUser /> Dashboard
                  </button>
                  <button className="dd-item" onClick={() => { setProfileOpen(false); navigate("/admin/notifications"); }}>
                    <FiBell /> Notifications
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
        <main className="admin-content">
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

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onOpen={() => setPaletteOpen(true)} />
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
        .admin-layout { display:flex; min-height:100vh; background: var(--bg); }

        /* ===== SIDEBAR ===== */
        .admin-sidebar {
          width: var(--sidebar-w);
          background: var(--surface);
          border-right: 1px solid var(--border);
          display:flex; flex-direction:column;
          position: sticky; top:0; height:100vh;
          z-index:60;
          transition: width .22s ease, transform .25s ease;
        }
        .admin-sidebar.collapsed { width: var(--sidebar-w-collapsed); }
        .admin-brand { display:flex; align-items:center; gap:10px; padding:18px 16px; border-bottom:1px solid var(--border); }
        .admin-brand-logo {
          width:36px; height:36px; flex-shrink:0; border-radius:10px;
          background: linear-gradient(135deg, var(--brand), var(--brand-strong));
          color:#fff; display:flex; align-items:center; justify-content:center; font-size:19px;
        }
        .admin-brand-text strong { display:block; font-size:16px; line-height:1; color:var(--text); }
        .admin-brand-text span { font-size:11px; color:var(--text-muted); }
        .admin-sidebar-scroll { flex:1; overflow-y:auto; overflow-x:hidden; padding:10px 10px 20px; }
        .admin-nav { display:flex; flex-direction:column; gap:14px; }
        .admin-nav-group { display:flex; flex-direction:column; gap:2px; }
        .admin-nav-label {
          font-size:10.5px; text-transform:uppercase; letter-spacing:.07em; font-weight:700;
          color:var(--text-muted); padding:6px 10px;
        }
        .admin-link {
          display:flex; align-items:center; gap:12px; padding:9px 10px;
          border-radius:8px; text-decoration:none; color:var(--text-secondary);
          font-size:13.5px; font-weight:500; white-space:nowrap; position:relative;
          transition: background .15s, color .15s;
        }
        .admin-link:hover { background: var(--surface-hover); color: var(--text); }
        .admin-link.active { background: var(--brand-soft); color: var(--brand); font-weight:600; }
        .admin-link.active::before {
          content:""; position:absolute; left:-10px; top:50%; transform:translateY(-50%);
          width:3px; height:22px; border-radius:3px; background: var(--brand);
        }
        .admin-nav-icon { font-size:17px; flex-shrink:0; }
        .admin-sidebar.collapsed .admin-link { justify-content:center; padding:10px 0; }
        .admin-sidebar.collapsed .admin-nav-label { display:none; }

        .admin-sidebar-foot { padding:12px; border-top:1px solid var(--border); }
        .admin-collapse-btn {
          width:100%; display:flex; align-items:center; justify-content:center; gap:10px;
          padding:9px; border:1px solid var(--border); background:var(--surface-2);
          color:var(--text-secondary); border-radius:8px; cursor:pointer; font-size:13px;
        }
        .admin-collapse-btn:hover { color:var(--text); background:var(--surface-hover); }
        .admin-sidebar.collapsed .admin-collapse-btn span { display:none; }

        /* ===== MOBILE DRAWER ===== */
        .admin-drawer { display:none; }
        .admin-overlay { display:none; }

        /* ===== MAIN ===== */
        .admin-main { flex:1; display:flex; flex-direction:column; min-width:0; }
        .admin-header {
          height: var(--header-h);
          background: var(--surface);
          border-bottom: 1px solid var(--border);
          display:flex; align-items:center; justify-content:space-between;
          padding:0 var(--content-pad);
          position: sticky; top:0; z-index:50; gap:16px;
        }
        .admin-header-left { display:flex; align-items:center; gap:14px; min-width:0; }
        .admin-mobile-menu { display:none; }
        .admin-breadcrumb { display:flex; flex-direction:column; min-width:0; }
        .admin-breadcrumb-root { font-size:12px; color:var(--text-muted); }
        .admin-breadcrumb-sep { color:var(--text-muted); margin:0 4px; }
        .admin-breadcrumb-current { display:none; }
        .admin-page-title { font-size:17px; font-weight:700; margin:0; color:var(--text); line-height:1.2; }

        .admin-header-right { display:flex; align-items:center; gap:10px; position:relative; }
        .admin-search-hint {
          position:absolute; top:9px; right:8px; font-size:10px; color:var(--text-muted);
        }

        .admin-profile { position:relative; }
        .admin-profile-btn {
          display:flex; align-items:center; gap:10px; background:none; border:none; cursor:pointer;
          padding:4px; border-radius:8px;
        }
        .admin-profile-btn:hover { background:var(--surface-hover); }
        .admin-avatar {
          width:36px; height:36px; border-radius:50%;
          background:linear-gradient(135deg, var(--brand), var(--brand-strong));
          color:#fff; display:flex; align-items:center; justify-content:center; font-weight:700;
        }
        .admin-profile-meta { display:flex; flex-direction:column; text-align:left; line-height:1.2; }
        .admin-profile-name { font-weight:600; font-size:13.5px; color:var(--text); }
        .admin-profile-role { font-size:11px; color:var(--text-muted); text-transform:capitalize; }

        .admin-content { padding: var(--content-pad); flex:1; }

        /* ===== RESPONSIVE ===== */
        @media (max-width: 1024px) {
          .admin-profile-meta { display:none; }
        }
        @media (max-width: 900px) {
          .admin-sidebar { display:none; }
          .admin-sidebar.admin-drawer {
            display:flex; position:fixed; left:0; top:0; transform:translateX(-100%);
            width: var(--sidebar-w); box-shadow: var(--shadow-lg);
          }
          .admin-sidebar.admin-drawer.open { transform:translateX(0); }
          .admin-overlay {
            display:block; position:fixed; inset:0; background:rgba(10,14,20,.5); z-index:55;
          }
          .admin-mobile-menu { display:inline-flex; }
        }
        @media (max-width: 640px) {
          .admin-content { padding:16px; }
          .admin-header { padding:0 14px; }
          .admin-search-hint { display:none; }
        }
      `}</style>
    </div>
  );
}
