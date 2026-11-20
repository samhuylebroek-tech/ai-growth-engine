// Connection errors are stored in English (provider responses, written by the server). This maps the known
// ones to the reader's language; anything unrecognised is shown as stored, never hidden.
type T = (key: never, vars?: Record<string, string | number>) => string;
const RULES: [RegExp, string][] = [
  [/^(.+) could not be reached\.$/, "xa.err.unreachable"],
  [/^(.+) no longer accepts the saved access\. Reconnect it\.$/, "xa.err.expired"],
  [/^(.+) refused access: the connection lacks the required read permission\.$/, "xa.err.scope"],
  [/^(.+) is rate limiting requests\. Try again later\.$/, "xa.err.rate"],
  [/^(.+) responded with status (\d{3})\.$/, "xa.err.status"],
  [/^(.+) returned an unreadable response\.$/, "xa.err.unreadable"],
  [/^Google access was revoked or expired\. Reconnect it\.$/, "xa.err.googleExpired"],
];
export function connectionErrorText(msg: string, t: T): string {
  for (const [re, key] of RULES) {
    const m = re.exec(msg.trim());
    if (m) return t(key as never, { p: m[1] ?? "", s: m[2] ?? "" });
  }
  return msg;
}
