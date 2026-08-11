import type { ZodError } from "zod";

export function documentImportFieldErrors(
  error: ZodError,
): Readonly<Record<string, readonly string[]>> {
  const fields: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const path = issue.path.join(".") || "_root";
    (fields[path] ??= []).push(issue.message);
  }
  return fields;
}
