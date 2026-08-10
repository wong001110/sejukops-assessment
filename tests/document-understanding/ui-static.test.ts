import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";

import { describe, expect, it } from "vitest";

const workspace = readFileSync(fileURLToPath(new URL(
  "../../src/components/admin/document-import/document-import-workspace.tsx",
  import.meta.url,
)), "utf8");
const api = readFileSync(fileURLToPath(new URL(
  "../../src/components/admin/document-import/api.ts",
  import.meta.url,
)), "utf8");
const page = readFileSync(fileURLToPath(new URL(
  "../../src/app/admin/document-import/page.tsx",
  import.meta.url,
)), "utf8");
const shell = readFileSync(fileURLToPath(new URL(
  "../../src/components/desktop-shell.tsx",
  import.meta.url,
)), "utf8");
const css = readFileSync(fileURLToPath(new URL(
  "../../src/styles/globals.css",
  import.meta.url,
)), "utf8");

describe("Document Understanding Admin UI", () => {
  it("provides the Admin route and selected navigation state", () => {
    expect(page).toContain("DocumentImportWorkspace");
    expect(shell).toContain('key: "/admin/document-import"');
    expect(shell).toContain('pathname.startsWith("/admin/document-import")');
  });

  it("uses the private signed upload and source-confirmation sequence", () => {
    expect(api).toContain("uploadToSignedUrl");
    expect(api).toContain("reservation.upload.token");
    expect(api).toContain("contentType: file.type");
    expect(api).toContain("/api/admin/document-imports/reservations");
    expect(api).toContain("/source/confirm");
    expect(workspace.indexOf("documentImportApi.reserve")).toBeLessThan(
      workspace.indexOf("documentImportApi.uploadSource"),
    );
    expect(workspace.indexOf("documentImportApi.uploadSource")).toBeLessThan(
      workspace.indexOf("documentImportApi.confirmSource"),
    );
  });

  it("shows every confidence state and keeps every extracted field editable", () => {
    for (const confidence of ["high", "medium", "low", "missing"]) {
      expect(workspace).toContain(`${confidence}: {`);
      expect(css).toContain(`confidence-${confidence}`);
    }
    for (const field of ["customerName", "serviceType", "serviceDetails", "amount", "date"]) {
      expect(workspace).toContain(`draft.${field}`);
      expect(workspace).toContain(`name="${field}"`);
    }
    for (const required of ["customerPhone", "customerAddress", "branchId"]) {
      expect(workspace).toContain(`name="${required}"`);
    }
  });

  it("requires an explicit preview and a separate confirmation before write", () => {
    expect(workspace).toContain("Preview reviewed order");
    expect(workspace).toContain("Previewing does not write an order");
    expect(workspace).toContain("This is the only step that writes operational data");
    expect(workspace).toContain("Confirm & create order");
    expect(workspace).toContain("documentImportApi.confirm(record.id");
    expect(workspace).not.toMatch(/useEffect\([\s\S]{0,300}documentImportApi\.confirm/);
  });

  it("preserves the source and exposes safe capability/provider recovery", () => {
    expect(workspace).toContain("The source remains securely stored");
    expect(workspace).toContain("AI_CAPABILITY_MISMATCH");
    expect(workspace).toContain("AI_NOT_CONFIGURED");
    expect(workspace).toContain("AI_AUTH_FAILED");
    expect(workspace).toContain('href="/admin/ai-settings"');
    expect(workspace).toContain("Retry extraction");
    expect(workspace).toContain("no order was created");
    expect(workspace).toContain("PDFs require readable embedded text");
    expect(workspace).toContain("export scanned PDFs without readable text as JPG, PNG, or WebP");
    expect(workspace).not.toContain("scanned PDFs require a vision-capable");
  });

  it("hydrates a durable import and can resume its exact reserved upload", () => {
    expect(workspace).toContain('DOCUMENT_IMPORT_RESUME_KEY = "sejukops.document-import.active"');
    expect(workspace).toContain("sessionStorage.setItem(DOCUMENT_IMPORT_RESUME_KEY");
    expect(workspace).toContain("documentImportApi.detail(saved.id)");
    expect(workspace).toContain("uploadKey.current = saved.sourceRequestKey");
    expect(workspace).toContain("Select the same source file to continue");
    expect(workspace).toContain("matchesReservation");
    expect(workspace).toContain("sessionStorage.removeItem(DOCUMENT_IMPORT_RESUME_KEY)");
  });

  it("bounds EXTRACTING polling and exposes explicit status/stale recovery", () => {
    expect(workspace).toContain('detail.documentImport.extractionStatus !== "EXTRACTING"');
    expect(workspace).toContain("attempts >= 6");
    expect(workspace).toContain("setTimeout(() => void poll(), 2_000)");
    expect(workspace).toContain("Refresh status");
    expect(workspace).toContain("Recover extraction");
    expect(workspace).toContain("extractRequestKey: stableExtractKey");
  });

  it("reconciles a confirmed order after reload or an ambiguous response", () => {
    expect(workspace).toContain("detail.documentImport.confirmation");
    expect(workspace).toContain("latest.documentImport.confirmation");
    expect(workspace).toContain("setResult(latest.documentImport.confirmation)");
    expect(workspace).toContain("Preserve the original confirmation key after an ambiguous response");
    expect(workspace).toContain("result.orderNo");
    expect(workspace).toContain("result.customerReused");
  });

  it("includes loading, error, success, responsive, focus, and reduced-motion states", () => {
    expect(workspace).toContain("<Skeleton active");
    expect(workspace).toContain('<Result status="success"');
    expect(workspace).toContain('type="error"');
    expect(workspace).toContain('loading={uploading}');
    expect(workspace).toContain('loading={extracting}');
    expect(workspace).toContain('loading={confirming}');
    expect(css).toContain("focus-within");
    expect(css).toContain("@media (max-width: 700px)");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
