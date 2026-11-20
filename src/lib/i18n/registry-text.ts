// Translated names/descriptions for code-registry entries; falls back to the registry text for keys without a translation.
type T = (key: string) => string;
const pick = (t: T, key: string, fallback: string) => { const v = t(key); return v === key ? fallback : v; };
export const capText = (t: T, c: { key: string; name: string; description: string }) => ({
  name: pick(t, `reg.cap.${c.key}.name`, c.name), description: pick(t, `reg.cap.${c.key}.desc`, c.description),
});
export const agentText = (t: T, a: { key: string; name: string; description: string }) => ({
  name: pick(t, `reg.agent.${a.key}.name`, a.name), description: pick(t, `reg.agent.${a.key}.desc`, a.description),
});
