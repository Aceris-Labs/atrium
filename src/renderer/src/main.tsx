import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/global.css";
import { initCacheBridge } from "./store/cache";
import { ToastProvider } from "./components/Toast";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { setupErrorHandlers } from "./setupErrorHandlers";

void initCacheBridge().then(() => {
  setupErrorHandlers();
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <ToastProvider>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </ToastProvider>
    </StrictMode>,
  );
});
