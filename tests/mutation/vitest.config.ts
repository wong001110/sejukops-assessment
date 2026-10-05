import { mergeConfig } from "vitest/config";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import rootConfig from "../../vitest.config";

function cleanId(id: string): string {
  return path.resolve(id.split("?", 1)[0].split("#", 1)[0]).replaceAll("\\", "/").toLowerCase();
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

const selectedFile = process.env.SEJUK_MUTATION_TARGET;
const original = process.env.SEJUK_MUTATION_ORIGINAL;
const replacement = process.env.SEJUK_MUTATION_REPLACEMENT;
const markerPath = process.env.SEJUK_MUTATION_MARKER;
let loadedCount = 0;

const mutationPlugin = {
  name: "sejuk-p6-targeted-mutation",
  enforce: "pre" as const,
  load(id: string) {
    if (!selectedFile || !original || replacement === undefined || !markerPath) return null;
    if (cleanId(id) !== cleanId(selectedFile)) return null;

    loadedCount += 1;
    const source = normalizeLineEndings(readFileSync(id.split("?", 1)[0].split("#", 1)[0], "utf8"));
    const normalizedOriginal = normalizeLineEndings(original);
    const normalizedReplacement = normalizeLineEndings(replacement);
    const occurrences = source.split(normalizedOriginal).length - 1;
    if (loadedCount !== 1 || occurrences !== 1) {
      writeFileSync(markerPath, JSON.stringify({
        status: "invalid",
        loadedCount,
        occurrences,
        id,
      }));
      throw new Error(`Mutation source must load once with one exact match (loads=${loadedCount}, matches=${occurrences})`);
    }

    writeFileSync(markerPath, JSON.stringify({ status: "loaded", loadedCount, occurrences, id }));
    return source.replace(normalizedOriginal, normalizedReplacement);
  },
};

export default mergeConfig(rootConfig, { plugins: [mutationPlugin] });
