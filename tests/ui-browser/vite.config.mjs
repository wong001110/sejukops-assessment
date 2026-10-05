import { fileURLToPath } from "node:url";

const previewRoot = fileURLToPath(new URL(".", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const previewPanel = fileURLToPath(new URL("../../src/components/admin/owner-preview/owner-preview-panel.tsx", import.meta.url)).replaceAll("\\", "/");
const config = {
  root: previewRoot,
  envFile: false,
  publicDir: "public",
  cacheDir: "node_modules/.vite-preview",
  resolve: { alias: [
    { find: /^next\/navigation$/, replacement: fileURLToPath(new URL("./next-navigation.ts", import.meta.url)) },
    { find: /^next\/link$/, replacement: fileURLToPath(new URL("./next-link.tsx", import.meta.url)) },
    { find: "@", replacement: fileURLToPath(new URL("../../src", import.meta.url)) },
  ] },
  esbuild: { jsx: "automatic" },
  optimizeDeps: { esbuildOptions: { jsx: "automatic" } },
  server: { host: "localhost", port: 3200, strictPort: true, fs: { allow: [repositoryRoot] } },
  plugins: [{ name: "synthetic-owner-preview-navigation", enforce: "pre", resolveId(source, importer) {
    // Exact component dependency in this synthetic renderer only. Product builds
    // never load this configuration; document verification explicitly excludes it.
    if (source === "./owner-preview-navigation" && importer?.split("?")[0].replaceAll("\\", "/") === previewPanel) {
      return fileURLToPath(new URL("./owner-preview-navigation.ts", import.meta.url));
    }
  } }, { name: "reject-unmocked-application-api", configureServer(server) {
    // A failed/stopped worker cannot reach the application or any proxy.
    server.middlewares.use((request, response, next) => {
      if (!/^\/api(?:\/|\?|$)/.test(request.url ?? "")) return next();
      response.statusCode = 500;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ error: `MOCK worker did not intercept ${request.method} ${request.url}` }));
    });
  } }],
};
export default config;
