import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const compat = new FlatCompat({ baseDirectory: __dirname });

const config = [...compat.extends("next/core-web-vitals", "next/typescript"), { ignores: [
  ".next/**", "node_modules/**", "supabase/.temp/**", "next-env.d.ts",
  // Preview build output and the unchanged MSW-generated worker are not authored source.
  "tests/ui-browser/dist/**", "tests/ui-browser/public/mockServiceWorker.js",
] }];

export default config;
