import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { WalletProvider } from "./wallet/WalletContext";
import { AuthProvider } from "./auth/AuthContext";
import { App } from "./App";
import { registerAppServiceWorker } from "./serviceWorker";
import "./styles.css";
import "../../../packages/ui/src/theme.css";

registerAppServiceWorker(import.meta.env.PROD);

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Application root element is missing.");

createRoot(rootElement).render(
  <StrictMode>
    <AuthProvider>
      <WalletProvider><App /></WalletProvider>
    </AuthProvider>
  </StrictMode>,
);
