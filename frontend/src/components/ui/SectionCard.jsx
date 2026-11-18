import React from "react";

/* Card wrapper for grouping related (form) fields. */
export default function SectionCard({ title, hint, children }) {
  return (
    <div className="card section-card">
      {title && (
        <div className="card-header">
          <div className="section-title">{title}</div>
          {hint && <div className="section-hint" style={{ marginBottom: 0 }}>{hint}</div>}
        </div>
      )}
      <div className="card-body">{children}</div>
    </div>
  );
}
