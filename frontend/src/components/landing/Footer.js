import React from "react";
import { Link } from "react-router-dom";
import { FiLayout } from "react-icons/fi";

const COLUMNS = [
  {
    title: "Product",
    links: [
      { label: "Features", href: "#features" },
      { label: "Dashboard", href: "#about" },
      { label: "Inventory", href: "#solutions" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", href: "#about" },
      { label: "Contact", href: "#contact" },
    ],
  },
  {
    title: "Account",
    links: [
      { label: "Login", to: "/login" },
      { label: "Register", to: "/register" },
    ],
  },
];

export default function Footer() {
  return (
    <footer className="ln-footer" id="contact">
      <div className="ln-container ln-footer-grid">
        <div className="ln-footer-brand">
          <div className="ln-logo">
            <span className="ln-logo-icon"><FiLayout /></span>
            <span className="ln-logo-text">OMS<em>Platform</em></span>
          </div>
          <p className="ln-footer-desc">
            A smarter way to manage your business operations.
          </p>
        </div>

        {COLUMNS.map((col) => (
          <div key={col.title} className="ln-footer-col">
            <h5 className="ln-footer-title">{col.title}</h5>
            <ul className="ln-footer-list">
              {col.links.map((l) =>
                l.to ? (
                  <li key={l.label}>
                    <Link to={l.to} className="ln-footer-link">{l.label}</Link>
                  </li>
                ) : (
                  <li key={l.label}>
                    <a href={l.href} className="ln-footer-link">{l.label}</a>
                  </li>
                )
              )}
            </ul>
          </div>
        ))}
      </div>

      <div className="ln-container ln-footer-bottom">
        © 2026 OMS. All rights reserved.
      </div>
    </footer>
  );
}
