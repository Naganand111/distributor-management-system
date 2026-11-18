import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";

// Import Bootstrap first
import "bootstrap/dist/css/bootstrap.min.css";

// Import your custom styles (overrides)
import "./styles.css";

// Enterprise design system (tokens, dark mode, component overrides)
import "./theme/design-system.css";

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
);
