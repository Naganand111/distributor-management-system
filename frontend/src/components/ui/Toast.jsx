import React, { createContext, useContext, useState, useCallback, useRef } from "react";

const ToastCtx = createContext(null);

const ICONS = {
  success: "✓",
  error: "✕",
  warning: "⚠",
  info: "ℹ",
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const remove = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((message, type = "info", duration = 3200) => {
    const id = ++idRef.current;
    setToasts((list) => [...list, { id, message, type }]);
    if (duration) {
      setTimeout(() => remove(id), duration);
    }
    return id;
  }, [remove]);

  const toast = useCallback((message, type) => push(message, type), [push]);
  toast.success = (m) => push(m, "success");
  toast.error = (m) => push(m, "error");
  toast.warning = (m) => push(m, "warning");
  toast.info = (m) => push(m, "info");

  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`oms-toast ${t.type}`} role="status">
            <span className="toast-icon">{ICONS[t.type] || ICONS.info}</span>
            <div className="toast-msg">{t.message}</div>
            <button className="toast-close" aria-label="Dismiss" onClick={() => remove(t.id)}>×</button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

export default ToastProvider;
