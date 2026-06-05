// ui/src/main.tsx — entrypoint. Mounts <App> into #root after loading styles.
import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/global.css";
import "./styles/shell.css";
import "./styles/dashboard.css";
import { App } from "./App";

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Castor: #root element not found");
}

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
