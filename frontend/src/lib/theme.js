import { useEffect, useState } from "react";

/* Resolve + apply theme; syncs with the inline script in index.html. */
export function getTheme() {
  if (typeof document !== "undefined" && document.documentElement) {
    return document.documentElement.getAttribute("data-theme") || "light";
  }
  return "light";
}

export function setTheme(theme) {
  if (typeof document !== "undefined" && document.documentElement) {
    document.documentElement.setAttribute("data-theme", theme);
  }
  try { localStorage.setItem("dms-theme", theme); } catch { /* ignore */ }
}

export default function useTheme() {
  const [theme, setState] = useState(getTheme());

  useEffect(() => {
    setTheme(theme);
  }, [theme]);

  const toggle = () => setState((t) => (t === "dark" ? "light" : "dark"));
  const apply = (t) => setState(t);

  return { theme, toggle, setTheme: apply };
}
