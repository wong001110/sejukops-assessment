import { AntdRegistry } from "@ant-design/nextjs-registry";
import type { Metadata } from "next";
import "antd/dist/reset.css";
import "antd-mobile/es/global";
import "@/styles/globals.css";

export const metadata: Metadata = { title: "SejukOps", description: "Field service operations workspace" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en-MY"><body><AntdRegistry>{children}</AntdRegistry></body></html>;
}
