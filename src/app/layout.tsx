import { AntdRegistry } from "@ant-design/nextjs-registry";
import type { Metadata } from "next";

import { AppQueryProvider } from "@/components/app-query-provider";

import "antd/dist/reset.css";
import "antd-mobile/es/global";
import "@/styles/globals.css";
import "@/styles/ui-polish.css";
import "@/styles/ui-refinements.css";
import "@/styles/ui-semantic-status.css";
import "@/styles/ui-modern-refresh.css";
import "@/styles/ui-modern-refresh-tuning.css";
import "@/styles/ui-diagnostics.css";

export const metadata: Metadata = {
  title: "SejukOps",
  description: "Field service operations workspace",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-MY">
      <body>
        <AntdRegistry>
          <AppQueryProvider>{children}</AppQueryProvider>
        </AntdRegistry>
      </body>
    </html>
  );
}
