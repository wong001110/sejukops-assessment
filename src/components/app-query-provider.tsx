"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConfigProvider } from "antd";
import { useState } from "react";

const sejukTheme = {
  token: {
    colorPrimary: "#176b87",
    colorInfo: "#176b87",
    colorSuccess: "#2f7d6c",
    colorWarning: "#c88932",
    colorError: "#c4473a",
    colorText: "#122233",
    colorTextSecondary: "#667788",
    colorBorder: "#dfe6ea",
    colorBgLayout: "#f7f9fa",
    borderRadius: 9,
    borderRadiusLG: 12,
    controlHeight: 38,
    fontFamily:
      'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
} as const;

/** One browser-tab query client lets operational writes invalidate Manager snapshots across portal routes. */
export function AppQueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1, refetchOnWindowFocus: false },
        },
      }),
  );
  return (
    <ConfigProvider theme={sejukTheme}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ConfigProvider>
  );
}
