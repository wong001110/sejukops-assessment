import ExcelJS from "exceljs";
import { deflateRawSync } from "node:zlib";
import { fromBufferPromise } from "yauzl";
import { describe, expect, it } from "vitest";
import { createStaffImportTemplate, parseStaffImportWorkbook } from "./spreadsheet";

const HEADERS = ["name", "email", "role", "branchCode"];
const VALID = ["Fictional Admin", "admin@example.invalid", "ADMIN", ""];

async function workbook(rows: ExcelJS.CellValue[][], headers: ExcelJS.CellValue[] = HEADERS): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  book.addWorksheet("Staff").addRows([headers, ...rows]);
  return Buffer.from(await book.xlsx.writeBuffer());
}

type ZipPart = { name: string; data: Buffer; declaredSize?: number; flags?: number };

async function unzip(bytes: Buffer): Promise<ZipPart[]> {
  const zip = await fromBufferPromise(bytes, { lazyEntries: true });
  const parts: ZipPart[] = [];
  try {
    for await (const entry of zip.eachEntry()) {
      const chunks: Buffer[] = [];
      const stream = await zip.openReadStreamPromise(entry);
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      parts.push({ name: entry.fileName, data: Buffer.concat(chunks) });
    }
  } finally {
    zip.close();
  }
  return parts;
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Build adversarial archives directly, including duplicate paths and false size
// metadata which normal workbook/ZIP writers will refuse or normalize away.
function zip(parts: ZipPart[]): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const part of parts) {
    const name = Buffer.from(part.name);
    const data = deflateRawSync(part.data);
    const checksum = crc32(part.data);
    const size = part.declaredSize ?? part.data.length;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(part.flags ?? 0, 6);
    header.writeUInt16LE(8, 8);
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(size, 22);
    header.writeUInt16LE(name.length, 26);
    local.push(header, name, data);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(part.flags ?? 0, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt32LE(checksum, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(size, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);
    offset += header.length + name.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(parts.length, 8);
  end.writeUInt16LE(parts.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

async function modifiedPart(name: string, modify: (text: string) => string): Promise<Buffer> {
  const parts = await unzip(await workbook([VALID]));
  const part = parts.find((item) => item.name === name)!;
  part.data = Buffer.from(modify(part.data.toString("utf8")));
  return zip(parts);
}

describe("staff spreadsheet", () => {
  it("generates a bounded template with three fictional rows and no password columns", async () => {
    const bytes = await createStaffImportTemplate();
    expect(bytes.length).toBeLessThan(1024 * 1024);
    const result = await parseStaffImportWorkbook(bytes);
    expect(result.validCount).toBe(3);
    expect(result.invalidCount).toBe(0);
    expect(result.rows.map((row) => row.input?.role)).toEqual(["ADMIN", "MANAGER", "TECHNICIAN"]);
    expect(result.rows.every((row) => row.input?.email.endsWith("@example.invalid"))).toBe(true);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(Uint8Array.from(bytes).buffer);
    expect(book.worksheets.map((sheet) => sheet.name)).toEqual(["Staff", "Instructions"]);
    expect(book.getWorksheet("Staff")!.getRow(1).values).toEqual([undefined, ...HEADERS]);
  });

  it("canonicalizes whitespace/email and ignores blank middle and trailing rows", async () => {
    const bytes = await workbook([
      ["  Fictional Admin  ", " ADMIN@EXAMPLE.INVALID ", "ADMIN", " "],
      ["", "", "", ""],
      ["Fictional Tech", "tech@example.invalid", "TECHNICIAN", "EXAMPLE_BRANCH"],
      ["", "", "", ""],
    ]);
    const preview = await parseStaffImportWorkbook(bytes);
    expect(preview.validCount).toBe(2);
    expect(preview.rows.map((row) => row.row)).toEqual([2, 4]);
    expect(preview.rows[0].input).toEqual({ name: "Fictional Admin", email: "admin@example.invalid", role: "ADMIN", branchCode: null });
  });

  it("treats security-looking words in text cells as data and avoids echoing an invalid role", async () => {
    const preview = await parseStaffImportWorkbook(await workbook([
      ["ExternalLink MacroEnabled Fictional", "externallink@example.invalid", "ADMIN", ""],
      ["Fictional", "other@example.invalid", "untrusted-role-secret", ""],
    ]));
    expect(preview.validCount).toBe(1);
    expect(preview.rows[1].errors.join(" ")).not.toContain("untrusted-role-secret");
  });

  it("rejects every duplicate email row, including an otherwise invalid row", async () => {
    const preview = await parseStaffImportWorkbook(await workbook([
      VALID, ["Other", " ADMIN@EXAMPLE.INVALID ", "TECHNICIAN", ""],
      ["Distinct", "distinct@example.invalid", "MANAGER", ""],
    ]));
    expect(preview.validCount).toBe(1);
    expect(preview.invalidCount).toBe(2);
    expect(preview.rows.slice(0, 2).every((row) => row.input === null && row.errors.includes("Email is duplicated in this workbook."))).toBe(true);
  });

  it("returns invalid rows for role, email and branch-mapping failures", async () => {
    const preview = await parseStaffImportWorkbook(await workbook([
      ["Tech", "tech@example.invalid", "TECHNICIAN", ""],
      ["Admin", "admin@example.invalid", "ADMIN", "EXAMPLE_BRANCH"],
      ["Manager", "invalid email", "SUPER_ADMIN", ""],
    ]));
    expect(preview.validCount).toBe(0);
    expect(preview.invalidCount).toBe(3);
    expect(preview.rows.every((row) => row.input === null && row.errors.length > 0)).toBe(true);
  });

  it.each([123, true, new Date("2026-01-01T00:00:00Z"), { richText: [{ text: "Name" }] }, { error: "#VALUE!" } as ExcelJS.CellErrorValue])(
    "does not coerce nontext cells (%j) into account fields", async (value) => {
      const preview = await parseStaffImportWorkbook(await workbook([[value, "admin@example.invalid", "ADMIN", ""]]));
      expect(preview.rows[0].input).toBeNull();
      expect(preview.rows[0].errors).toContain("name must be plain text; formulas and nontext cells are not accepted.");
    },
  );

  it("rejects formulas even when they have a cached text result", async () => {
    await expect(parseStaffImportWorkbook(await workbook([[{ formula: '"Fictional Admin"', result: "Fictional Admin" }, ...VALID.slice(1)]]))).rejects.toThrow("without formulas");
  });

  it.each([
    ["name", "email", "role", "branchCode", "password"],
    ["Name", "email", "role", "branchCode"],
    ["name", "role", "email", "branchCode"],
    ["name", "email", "role"],
    ["name", "email", "email", "branchCode"],
  ])("rejects missing, changed, reordered or added headers (%j)", async (...headers) => {
    await expect(parseStaffImportWorkbook(await workbook([VALID], headers))).rejects.toThrow("headers");
  });

  it("rejects extra data cells even with no extra header", async () => {
    await expect(parseStaffImportWorkbook(await workbook([[...VALID, "never-a-password"]]))).rejects.toThrow("extra columns");
  });

  it("requires a Staff sheet and rejects additional/hidden sheets", async () => {
    const book = new ExcelJS.Workbook();
    book.addWorksheet("Other").addRows([HEADERS, VALID]);
    await expect(parseStaffImportWorkbook(Buffer.from(await book.xlsx.writeBuffer()))).rejects.toThrow("Staff sheet");
    book.addWorksheet("Staff").addRows([HEADERS, VALID]);
    await expect(parseStaffImportWorkbook(Buffer.from(await book.xlsx.writeBuffer()))).rejects.toThrow("Staff sheet");
    book.removeWorksheet("Other");
    book.getWorksheet("Staff")!.state = "hidden";
    await expect(parseStaffImportWorkbook(Buffer.from(await book.xlsx.writeBuffer()))).rejects.toThrow("visible Staff");
  });

  it("accepts exactly 100 rows and rejects 101", async () => {
    const rows = Array.from({ length: 100 }, (_, index) => ["Fictional Admin", `admin${index}@example.invalid`, "ADMIN", ""]);
    expect((await parseStaffImportWorkbook(await workbook(rows))).validCount).toBe(100);
    await expect(parseStaffImportWorkbook(await workbook([...rows, ["Other", "extra@example.invalid", "ADMIN", ""]]))).rejects.toThrow("at most 100");
  });

  it("requires at least one nonempty employee row", async () => {
    await expect(parseStaffImportWorkbook(await workbook([]))).rejects.toThrow("at least one");
  });

  it.each([Buffer.alloc(0), Buffer.alloc(1024 * 1024 + 1), Buffer.from("CSV,name,email"), Buffer.from([1, 2]), Buffer.from("PK\u0003\u0004garbage")])(
    "rejects oversized, empty, non-xlsx and malformed archives", async (bytes) => {
      await expect(parseStaffImportWorkbook(bytes)).rejects.toThrow();
    },
  );

  it("rejects expanded entry sizes before ExcelJS", async () => {
    const parts = await unzip(await workbook([VALID]));
    const archive = zip([...parts, { name: "xl/huge.xml", data: Buffer.from(`<x>${"A".repeat(2 * 1024 * 1024)}</x>`) }]);
    expect(archive.length).toBeLessThan(1024 * 1024);
    await expect(parseStaffImportWorkbook(archive)).rejects.toThrow("valid, unencrypted");
  });

  it("rejects false small uncompressed metadata while streaming actual expanded bytes", async () => {
    const parts = await unzip(await workbook([VALID]));
    const archive = zip([...parts, { name: "xl/huge.xml", data: Buffer.alloc(2 * 1024 * 1024 + 1, 65), declaredSize: 1 }]);
    await expect(parseStaffImportWorkbook(archive)).rejects.toThrow("valid, unencrypted");
  });

  it("bounds total actual expanded bytes across individually accepted XML parts", async () => {
    const parts = await unzip(await workbook([VALID]));
    const archive = zip([...parts, ...Array.from({ length: 5 }, (_, index) => ({ name: `xl/part${index}.xml`, data: Buffer.from(`<x>${"A".repeat(1_800_000)}</x>`) }))]);
    expect(archive.length).toBeLessThan(1024 * 1024);
    await expect(parseStaffImportWorkbook(archive)).rejects.toThrow("valid, unencrypted");
  });

  it("bounds entry count", async () => {
    const parts = await unzip(await workbook([VALID]));
    await expect(parseStaffImportWorkbook(zip([...parts, ...Array.from({ length: 129 }, (_, index) => ({ name: `xl/part${index}.xml`, data: Buffer.from("<x/>") }))]))).rejects.toThrow();
  });

  it.each(["../xl/workbook.xml", "xl/../workbook.xml", "xl\\workbook.xml", "/xl/workbook.xml", "xl/%2e%2e.xml", "xl/vbaProject.bin", "xl/externalLinks/link.xml", "xl/embeddings/thing.xml", "xl/activex/thing.xml"])(
    "rejects dangerous ZIP path/part %s", async (name) => {
      await expect(parseStaffImportWorkbook(zip([{ name, data: Buffer.from("<x/>") }]))).rejects.toThrow();
    },
  );

  it("rejects duplicate and case-ambiguous ZIP parts", async () => {
    const parts = await unzip(await workbook([VALID]));
    const original = parts.find((part) => part.name === "xl/workbook.xml")!;
    await expect(parseStaffImportWorkbook(zip([...parts, original]))).rejects.toThrow();
    await expect(parseStaffImportWorkbook(zip([...parts, { ...original, name: "XL/WORKBOOK.XML" }]))).rejects.toThrow();
  });

  it("rejects encrypted entries", async () => {
    await expect(parseStaffImportWorkbook(zip([{ name: "xl/workbook.xml", data: Buffer.from("<x/>"), flags: 1 }]))).rejects.toThrow();
  });

  it.each([
    '<!DOCTYPE worksheet [<!ENTITY bomb "expanded">]>',
    '<!ENTITY bomb SYSTEM "file:///private">',
    '<Relationship TargetMode="External" Target="https://example.invalid"/>',
    '<Relationship TargetMode="&#69;xternal" Target="https://example.invalid"/>',
    '<Override ContentType="application/vnd.ms-excel.sheet.macroEnabled.main+xml"/>',
  ])("rejects dangerous XML before load (%s)", async (xml) => {
    const parts = await unzip(await workbook([VALID]));
    parts.push({ name: "xl/extra.xml", data: Buffer.from(xml) });
    await expect(parseStaffImportWorkbook(zip(parts))).rejects.toThrow();
  });

  it("rejects UTF-16 and malformed UTF-8 rather than inspect a different XML encoding", async () => {
    const parts = await unzip(await workbook([VALID]));
    await expect(parseStaffImportWorkbook(zip([...parts, { name: "xl/extra.xml", data: Buffer.from("<x/>", "utf16le") }]))).rejects.toThrow();
    await expect(parseStaffImportWorkbook(zip([...parts, { name: "xl/extra.xml", data: Buffer.from([0xff, 0xfe, 0x61]) }]))).rejects.toThrow();
  });

  it.each([
    (xml: string) => xml.replace('<row r="2"', '<row r="1048576"'),
    (xml: string) => xml.replace('r="A2"', 'r="XFD2"'),
    (xml: string) => xml.replace('r="B2"', 'r="A2"'),
    (xml: string) => xml.replace('<row r="2"', '<row r="1"'),
    (xml: string) => xml.replace('<row r="2"', '<row'),
  ])("rejects sparse or overwritten row/cell coordinates before load", async (modify) => {
    await expect(parseStaffImportWorkbook(await modifiedPart("xl/worksheets/sheet1.xml", modify))).rejects.toThrow();
  });

  it("rejects enormous workbook worksheet IDs before allocation", async () => {
    await expect(parseStaffImportWorkbook(await modifiedPart("xl/workbook.xml", (xml) => xml.replace('sheetId="1"', 'sheetId="999999999"')))).rejects.toThrow();
  });

  it("rejects merged-cell layouts and external hyperlinks", async () => {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet("Staff");
    sheet.addRows([HEADERS, VALID]);
    sheet.mergeCells("A2:B2");
    await expect(parseStaffImportWorkbook(Buffer.from(await book.xlsx.writeBuffer()))).rejects.toThrow();
    sheet.unMergeCells("A2:B2");
    sheet.getCell("A2").value = { text: "Fictional Admin", hyperlink: "https://example.invalid" };
    await expect(parseStaffImportWorkbook(Buffer.from(await book.xlsx.writeBuffer()))).rejects.toThrow();
  });
});
