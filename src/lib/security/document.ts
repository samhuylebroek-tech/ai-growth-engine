import { unzipSync, strFromU8 } from "fflate";
import { XMLParser } from "fast-xml-parser";
import { MAX_UPLOAD_BYTES } from "./upload";

const MAX_EXPANDED = 40 * 1024 * 1024;
const MAX_TEXT = 50000;
const parser = new XMLParser({ ignoreAttributes: false, processEntities: false, isArray: name => ["row", "c", "si"].includes(name) });

/** Bound ZIP expansion before decompression; never execute office macros or external links. */
export function extractOfficeText(bytes: Uint8Array, extension: "docx" | "xlsx"): string {
  if (bytes.length > MAX_UPLOAD_BYTES) throw new Error("File is larger than 20 MB.");
  let total = 0; let entries = 0;
  const files = unzipSync(bytes, { filter: file => {
    total += file.originalSize; entries++;
    if (total > MAX_EXPANDED || entries > 2000) throw new Error("The document expands beyond the safe reading limit.");
    return extension === "docx" ? /^word\/(document|header\d+|footer\d+)\.xml$/.test(file.name) : /^xl\/(sharedStrings|worksheets\/sheet\d+)\.xml$/.test(file.name);
  } });
  const read = (bytes: Uint8Array) => {
    const xml = strFromU8(bytes);
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("Document contains unsupported XML entities.");
    return xml;
  };
  let result = "";
  if (extension === "docx") {
    if (!files["word/document.xml"]) throw new Error("This is not a valid Word document.");
    for (const [name, value] of Object.entries(files)) {
      const xml = read(value);
      result += `\n${name}\n` + xml.replace(/<w:tab\b[^>]*\/>/g, "\t").replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
      if (result.length > MAX_TEXT) break;
    }
  } else {
    const shared = files["xl/sharedStrings.xml"] ? parser.parse(read(files["xl/sharedStrings.xml"])).sst?.si ?? [] : [];
    const textValue = (v: unknown): string => {
      if (v == null) return "";
      if (typeof v !== "object") return String(v);
      if (Array.isArray(v)) return v.map(textValue).join("");
      return Object.entries(v).filter(([k]) => !k.startsWith("@_")).map(([, value]) => textValue(value)).join("");
    };
    const strings = shared.map(textValue);
    const sheets = Object.entries(files).filter(([name]) => name.startsWith("xl/worksheets/"));
    if (!sheets.length) throw new Error("This is not a valid Excel workbook.");
    for (const [name, value] of sheets) {
      const rows = parser.parse(read(value)).worksheet?.sheetData?.row ?? [];
      result += `\n${name}\n`;
      for (const row of rows) {
        result += (row.c ?? []).map((cell: Record<string, unknown>) => cell["@_t"] === "s" ? strings[Number(cell["v"])] ?? "" : textValue(cell["v"] ?? cell["is"])).join("\t") + "\n";
        if (result.length > MAX_TEXT) break;
      }
      if (result.length > MAX_TEXT) break;
    }
  }
  if (!result.trim()) throw new Error("The document contains no readable text.");
  return result.slice(0, MAX_TEXT);
}