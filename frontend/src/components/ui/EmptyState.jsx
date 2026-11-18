import React from "react";

/* Professional empty state. icon = React node or emoji. */
export default function EmptyState({ icon = "📦", title = "Nothing here yet", sub = "", action }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <div className="empty-title">{title}</div>
      {sub && <div className="empty-sub">{sub}</div>}
      {action}
    </div>
  );
}
