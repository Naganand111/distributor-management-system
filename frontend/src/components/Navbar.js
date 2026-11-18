import React, { useEffect, useState } from "react";
import { NavLink, Link, useNavigate } from "react-router-dom";
import api from "../lib/api";
import { getUser, logout as clearStorage } from "../lib/storage";
import { getCart } from "../lib/auth";

export default function Navbar() {
  const user = getUser();
  const navigate = useNavigate();

  const [cartCount, setCartCount] = useState(0);

  /* 🛒 LOAD CART COUNT */
  const loadCart = () => {
    const cart = getCart() || [];
    const total = cart.reduce((sum, i) => sum + i.quantity, 0);
    setCartCount(total);
  };

  useEffect(() => {
    loadCart();

    window.addEventListener("cartUpdated", loadCart);
    return () => window.removeEventListener("cartUpdated", loadCart);
  }, []);

  /* 🚪 LOGOUT */
  const handleLogout = async () => {
    try {
      await api.post("/auth/logout");
    } catch { }

    clearStorage();
    navigate("/login");
  };

  return (
    <nav style={styles.nav}>
      <div style={styles.container}>
        {/* 🍎 LOGO */}
        <Link to="/" style={styles.logo}>
          NP Store
        </Link>

        {/* MENU */}
        <div style={styles.links}>
          <NavLink to="/products" style={linkStyle}>
            Store
          </NavLink>

          {user && user.role === "customer" && (
            <>
              <NavLink to="/orders" style={linkStyle}>
                My Orders
              </NavLink>

              {/* 🛒 CART */}
              <NavLink to="/cart" style={linkStyle}>
                🛒 Cart
                {cartCount > 0 && (
                  <span style={styles.badge}>{cartCount}</span>
                )}
              </NavLink>
            </>
          )}

          {!user ? (
            <>
              <NavLink to="/login" style={linkStyle}>
                Login
              </NavLink>
              <NavLink to="/register" style={linkStyle}>
                Register
              </NavLink>
            </>
          ) : (
            <>
              <span style={styles.user}>Hi, {user.name}</span>
              <button onClick={handleLogout} style={styles.logout}>
                Logout
              </button>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}

/* 🔥 ACTIVE LINK STYLE */
const linkStyle = ({ isActive }) => ({
  textDecoration: "none",
  color: isActive ? "#0071e3" : "#1d1d1f",
  fontWeight: isActive ? "600" : "400",
  fontSize: "14px",
});

/* 🎨 STYLES */
const styles = {
  nav: {
    background: "#fff",
    borderBottom: "1px solid #eee",
    padding: "12px 0",
    position: "sticky",
    top: 0,
    zIndex: 1000,
  },

  container: {
    width: "90%",
    margin: "auto",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },

  logo: {
    fontSize: "20px",
    fontWeight: "600",
    textDecoration: "none",
    color: "#000",
  },

  links: {
    display: "flex",
    gap: "20px",
    alignItems: "center",
  },

  user: {
    fontSize: "14px",
    color: "#555",
  },

  logout: {
    border: "none",
    background: "none",
    color: "#0071e3",
    cursor: "pointer",
    fontSize: "14px",
  },

  /* 🛒 BADGE */
  badge: {
    marginLeft: "5px",
    background: "#ff3b30",
    color: "#fff",
    borderRadius: "50%",
    padding: "2px 6px",
    fontSize: "11px",
  },
};