"use client";

import { useEffect } from "react";
import { ThemeProvider } from "next-themes";
import { ConfirmProvider } from "@/components/confirm-modal";
import { ToastProvider } from "@/components/toast";

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  return (
    <ThemeProvider attribute="class" defaultTheme="light" forcedTheme="light" enableSystem={false} disableTransitionOnChange>
      <ConfirmProvider>
        <ToastProvider>
          {children}
        </ToastProvider>
      </ConfirmProvider>
    </ThemeProvider>
  );
}
