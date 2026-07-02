import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "./auth";
import { BrandProvider } from "./brand";
import { TooltipProvider } from "./components/ui";
import { ThemeProvider } from "./theme";
import { App } from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <BrandProvider>
            <TooltipProvider>
              <App />
            </TooltipProvider>
          </BrandProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
);
