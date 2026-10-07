/**
 * ============================================================
 * File: main.tsx
 * ============================================================
 *
 * Entry point of the web application.
 *
 * ============================================================
 */

import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import "survey-core/survey-core.fontless.css";
import "./styles/capture-media.css";
import "./styles/participant.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
