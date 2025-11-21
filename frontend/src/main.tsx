import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./utils/axiosConfig"; // Initialize axios interceptors
import "./i18n/config"; // Initialize i18n
import "./index.css";
import reportWebVitals from "./utils/reportWebVitals";
import ErrorBoundary from "./components/ErrorBoundary";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

reportWebVitals();
