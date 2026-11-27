/**
 * One screen area's interface texts. Every key must exist in all three languages:
 * a key missing (or extra) in one language is a type error.
 */
export function defineArea<K extends string>(
  prefix: string,
  d: { en: Record<K, string>; nl: Record<K, string>; fr: Record<K, string> },
) {
  return { prefix, ...d };
}
