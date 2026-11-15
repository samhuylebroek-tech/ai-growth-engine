export function isRecoveryHash(hash: string): boolean {
  return new URLSearchParams(hash.replace(/^#/, "")).get("type") === "recovery";
}
