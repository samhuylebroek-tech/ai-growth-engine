// Question focus for the Growth Officer (pure, no AI, no credits). Fixed keyword rules in English, Dutch and French map a
// question to the business-context sections that answer it, so those sections are kept and read first while unrelated
// sections become background that may be trimmed for size. Nothing is hidden for permission reasons: every section was
// already read under the asker's own access. A question that matches nothing, or too many topics, gets no focus.

export const FOCUS_TOPICS = ["money", "campaigns", "execution", "kpis", "customers", "competitors", "website", "content", "strategy", "experiments"] as const;
export type FocusTopic = (typeof FOCUS_TOPICS)[number];

/** Word starts (accents removed, lower case). A word matches when it begins with one of these. */
const WORDS: Record<FocusTopic, readonly string[]> = {
  money: ["budget", "omzet", "revenue", "revenu", "chiffre d'affaires", "inkomst", "kost", "cost", "cout", "uitgav", "spend", "depens", "winst", "profit", "benefice", "marge", "margin", "roas", "cac", "roi", "rendement", "prijs", "price", "pricing", "prix", "tarif", "geld", "money", "argent", "euro", "factur", "invoice", "betal", "payment", "paiement", "terugbetal", "refund", "rembours", "credit"],
  campaigns: ["campag", "campaign", "advert", "reclame", "publicit", "ads", "annonce", "kanaal", "kanalen", "channel", "canal", "canaux"],
  execution: ["taak", "taken", "task", "tache", "blok", "block", "bloq", "stuck", "coince", "vertraag", "vertraging", "delay", "retard", "achterstal", "overdue", "deadline", "echeance", "goedkeur", "approv", "valid", "uitvoer", "execut", "project", "projet", "wacht", "waiting", "attente", "eerst", "first", "d'abord", "en premier", "volgende", "next", "prochain"],
  kpis: ["kpi", "metric", "meting", "metingen", "indicat", "conversie", "conversion", "resultat", "result", "prestat", "perform", "cijfer", "figure", "chiffre", "meten", "measure", "mesur", "trend", "daling", "stijging", "drop", "decline", "baisse", "hausse", "doelwaarde", "target", "cible"],
  customers: ["klant", "customer", "client", "lead", "pipeline", "deal", "verkoop", "verkopen", "sales", "sell", "vente", "vendre", "offerte", "quote", "devis", "prospect", "doelgroep", "audience", "retentie", "retention", "fidel", "churn", "opzeg"],
  competitors: ["concurrent", "concurren", "competit", "rival"],
  website: ["seo", "website", "webpagina", "site", "zoekmachine", "search engine", "moteur de recherche", "google", "vindbaar", "ranking", "referencement"],
  content: ["content", "contenu", "inhoud", "blog", "artikel", "article", "nieuwsbrief", "newsletter", "social", "linkedin", "instagram", "facebook", "tekst", "text", "texte", "copy"],
  strategy: ["strateg", "doel", "goal", "objecti", "priorit", "kans", "kansen", "opportun", "plan", "initiatie", "initiative", "aanpak", "approach", "approche", "volgende stap", "next step", "prochaine etape"],
  experiments: ["experiment", "test", "proef", "essai", "a/b", "hypothes", "leer", "learn", "lesson", "appren"],
};

/** Business-context section keys (see business-context.ts) that answer each topic. */
export const FOCUS_SECTIONS: Record<FocusTopic, readonly string[]> = {
  money: ["growth-economics", "budget-lines", "revenue-and-attribution", "sales-pipeline"],
  campaigns: ["campaigns-and-performance", "growth-economics", "tracked-metrics", "experiments-and-learnings"],
  execution: ["blocked-work", "approved-growth-plans", "detected-signals"],
  kpis: ["tracked-metrics", "growth-indicators", "campaigns-and-performance"],
  customers: ["sales-pipeline", "owner-answers", "revenue-and-attribution", "growth-indicators"],
  competitors: ["competitor-intelligence"],
  website: ["website-check", "content-studio"],
  content: ["content-studio", "website-check"],
  strategy: ["growth-goals", "approved-growth-plans", "growth-opportunities", "growth-levers", "completed-initiative-outcomes"],
  experiments: ["experiments-and-learnings", "improvement-proposals", "growth-economics"],
};

/** More topics than this means a broad question: no focus, the default context applies. */
export const MAX_FOCUS_TOPICS = 4;

const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[’`]/g, "'");
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const PATTERNS = Object.fromEntries(
  FOCUS_TOPICS.map((t) => [t, new RegExp(`(?:^|[^a-z0-9])(?:${WORDS[t].map(escape).join("|")})`, "i")]),
) as Record<FocusTopic, RegExp>;

export type QuestionFocus = { topics: FocusTopic[]; sections: string[] };

/** Topics and sections for a question; `previous` (the asker's earlier message) helps short follow-ups like "and why?". */
export function questionFocus(question: string, previous?: string | null): QuestionFocus {
  const match = (text: string) => FOCUS_TOPICS.filter((t) => PATTERNS[t].test(fold(text)));
  let topics = match(question);
  if (!topics.length && previous) topics = match(previous);
  if (!topics.length || topics.length > MAX_FOCUS_TOPICS) return { topics: [], sections: [] };
  const sections = [...new Set(topics.flatMap((t) => FOCUS_SECTIONS[t]))];
  return { topics, sections };
}
