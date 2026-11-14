import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { extractOfficeText } from "@/lib/security/document";

describe("office document reading", () => {
  it("extracts Word text without executing content", () => {
    const file = zipSync({ "word/document.xml": strToU8('<w:document><w:p><w:r><w:t>Business plan</w:t></w:r></w:p></w:document>') });
    expect(extractOfficeText(file, "docx")).toContain("Business plan");
  });
  it("extracts Excel shared strings and numeric cells", () => {
    const file = zipSync({ "xl/sharedStrings.xml": strToU8('<sst><si><t>Revenue</t></si></sst>'), "xl/worksheets/sheet1.xml": strToU8('<worksheet><sheetData><row><c t="s"><v>0</v></c><c><v>125</v></c></row></sheetData></worksheet>') });
    expect(extractOfficeText(file, "xlsx")).toContain("Revenue\t125");
  });
  it("rejects XML entity declarations", () => {
    const file = zipSync({ "word/document.xml": strToU8('<!DOCTYPE x [<!ENTITY x SYSTEM "file:///etc/passwd">]><w:t>&x;</w:t>') });
    expect(() => extractOfficeText(file, "docx")).toThrow("entities");
  });
  it("bounds expanded ZIP content", () => {
    const file = zipSync({ "word/document.xml": new Uint8Array(41 * 1024 * 1024) });
    expect(() => extractOfficeText(file, "docx")).toThrow("safe reading limit");
  });
});