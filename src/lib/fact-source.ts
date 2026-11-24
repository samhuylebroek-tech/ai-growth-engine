// Message keys for where a business fact came from, shared by every screen that names a fact's source,
// so a source never shows as a raw internal value ("user", "ai_assumption").
export const FACT_SOURCE_LABEL = {
  user: "account.profile.source.user",
  document: "account.profile.source.document",
  website: "account.profile.source.website",
  ai_assumption: "account.profile.source.ai_assumption",
  external: "account.profile.source.external",
} as const;

export function factSourceKey(sourceType: string) {
  return sourceType in FACT_SOURCE_LABEL
    ? FACT_SOURCE_LABEL[sourceType as keyof typeof FACT_SOURCE_LABEL]
    : null;
}
