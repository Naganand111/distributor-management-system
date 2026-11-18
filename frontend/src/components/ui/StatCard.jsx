import React from "react";

/* Executive KPI / stat card. Icon may be a React node. */
export default function StatCard({ label, value, icon, sub, tint = "", trend, trendUp, footer }) {
  return (
    <div className={`stat-card ${tint ? `tint-${tint}` : ""}`}>
      {icon && <div className="stat-icon">{icon}</div>}
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {trend != null && (
        <div className={trend > 0 ? "stat-trend-up" : "stat-trend-down"}>
          {trend > 0 ? "▲" : "▼"} {Math.abs(trend)}%
        </div>
      )}
      {footer && <div className="stat-footer">{footer}</div>}
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}
