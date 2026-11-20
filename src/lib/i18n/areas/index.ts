import { officer } from "./officer";
import { goals } from "./goals";
import { performance } from "./performance";
import { settings } from "./settings";
import { work } from "./work";
import { marketing } from "./marketing";
import { pages } from "./pages";
import { home } from "./home";
import { run } from "./run";
import { orch } from "./orch";
import { cost } from "./cost";
import { xa } from "./xa";

/** Every screen area; each keeps its own texts so areas can be translated independently. */
export const AREAS = [officer, goals, performance, settings, work, marketing, pages, home, run, orch, cost, xa] as const;
export const AREA_EN = { ...officer.en, ...goals.en, ...performance.en, ...settings.en, ...work.en, ...marketing.en, ...pages.en, ...home.en, ...run.en, ...orch.en, ...cost.en, ...xa.en };
export const AREA_NL = { ...officer.nl, ...goals.nl, ...performance.nl, ...settings.nl, ...work.nl, ...marketing.nl, ...pages.nl, ...home.nl, ...run.nl, ...orch.nl, ...cost.nl, ...xa.nl };
export const AREA_FR = { ...officer.fr, ...goals.fr, ...performance.fr, ...settings.fr, ...work.fr, ...marketing.fr, ...pages.fr, ...home.fr, ...run.fr, ...orch.fr, ...cost.fr, ...xa.fr };
