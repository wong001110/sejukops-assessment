import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

// Use the already installed Vite dependency of Vitest; no package install/download.
const require = createRequire(import.meta.url);
const vitestRequire = createRequire(require.resolve("vitest/package.json"));
const { createServer } = await import(pathToFileURL(vitestRequire.resolve("vite")).href);
const server = await createServer({ configFile: fileURLToPath(new URL("./vite.config.mjs", import.meta.url)) });
await server.listen();
server.printUrls();
