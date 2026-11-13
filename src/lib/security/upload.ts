export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const ALLOWED_UPLOADS: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/csv": "csv",
  "text/plain": "txt",
  "text/markdown": "md",
};
const EXT_OK = ["pdf", "docx", "xlsx", "csv", "txt", "md"];

export function validateUpload(name: string, mime: string, size: number): { ok: true } | { ok: false; reason: string } {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (!EXT_OK.includes(ext)) return { ok: false, reason: "File type not supported" };
  if (mime && !ALLOWED_UPLOADS[mime] && !(ext === "md" || ext === "csv")) return { ok: false, reason: "File type not supported" };
  if (size <= 0) return { ok: false, reason: "File is empty" };
  if (size > MAX_UPLOAD_BYTES) return { ok: false, reason: "File is larger than 20 MB" };
  return { ok: true };
}

export function safeFileName(name: string): string {
  return name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").slice(0, 120);
}

/** Wrap untrusted text before it enters a prompt so the model treats it as data. */
export function quoteUntrusted(label: string, text: string, max = 12000): string {
  const clean = text.replace(/<\/?untrusted[^>]*>/gi, "").slice(0, max);
  return `<untrusted source="${label.replace(/"/g, "")}">\n${clean}\n</untrusted>`;
}
