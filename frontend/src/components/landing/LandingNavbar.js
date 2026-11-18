import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { FiMenu, FiX, FiLayout } from "react-icons/fi";

const NAV_LINKS = [
  { label: "Home", href: "#home" },
  { label: "Features", href: "#features" },
  { label: "Solutions", href: "#solutions" },
  { label: "About", href: "#about" },
];

export default function LandingNavbar() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const go = (path) => {
    setOpen(false);
    navigate(path);
  };

  return (
    <header className={`ln-navbar ${scrolled ? "scrolled" : ""}`}>
      <div className="ln-nav-inner">
        {/* Logo */}
        <motion.a
          className="ln-logo"
          href="#home"
          onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); }}
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <span className="ln-logo-icon"><FiLayout /></span>
          <span className="ln-logo-text">OMS<em>Platform</em></span>
        </motion.a>

        {/* Desktop nav */}
        <nav className="ln-nav-links">
          {NAV_LINKS.map((l) => (
            <a key={l.label} href={l.href} className="ln-nav-link">
              {l.label}
            </a>
          ))}
        </nav>

        {/* Desktop actions */}
        <motion.div
          className="ln-nav-actions"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          <button className="ln-btn ln-btn-ghost" onClick={() => go("/login")}>
            Login
          </button>
          <button className="ln-btn ln-btn-primary" onClick={() => go("/register")}>
            Get Started
          </button>
        </motion.div>

        {/* Mobile toggle */}
        <button className="ln-menu-toggle" aria-label="Open menu" onClick={() => setOpen((o) => !o)}>
          {open ? <FiX /> : <FiMenu />}
        </button>
      </div>

      {/* Mobile menu */}
      <AnimatePresence>
        {open && (
          <motion.nav
            className="ln-mobile-menu"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25 }}
          >
            {NAV_LINKS.map((l) => (
              <a
                key={l.label}
                href={l.href}
                className="ln-mobile-link"
                onClick={() => setOpen(false)}
              >
                {l.label}
              </a>
            ))}
            <div className="ln-mobile-actions">
              <button className="ln-btn ln-btn-ghost w-full" onClick={() => go("/login")}>
                Login
              </button>
              <button className="ln-btn ln-btn-primary w-full" onClick={() => go("/register")}>
                Get Started
              </button>
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
}
