import React from "react";

/* Skeleton loaders. Use <Skeleton type="card|table|chart" rows=n /> */
export default function Skeleton({ type = "text", rows = 3 }) {
  if (type === "card") {
    return (
      <div className="row g-3">
        {[...Array(Math.max(rows, 1))].map((_, i) => (
          <div className="col-md-3 col-6" key={i}>
            <div className="skeleton skeleton-card" />
          </div>
        ))}
      </div>
    );
  }
  if (type === "table") {
    return (
      <div className="card skeleton" style={{ padding: 18 }}>
        {[...Array(Math.max(rows, 1))].map((_, i) => (
          <div key={i} className="skeleton skeleton-table-row" />
        ))}
      </div>
    );
  }
  if (type === "chart") {
    return <div className="skeleton" style={{ height: 300, borderRadius: 12 }} />;
  }
  return (
    <div>
      {[...Array(Math.max(rows, 1))].map((_, i) => (
        <div key={i} className={`skeleton skeleton-text ${i === 0 ? "w-75" : ""}`} />
      ))}
    </div>
  );
}
