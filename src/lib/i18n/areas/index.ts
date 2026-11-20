import { account } from "./account";
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
import { bi } from "./bi";
import { org } from "./org";
import { ogo } from "./ogo";
import { ev } from "./ev";
import { head } from "./head";
import { apv } from "./apv";

/** Every screen area; each keeps its own texts so areas can be translated independently. */
export const AREAS = [account, officer, goals, performance, settings, work, marketing, pages, home, run, orch, cost, xa, bi, org, ogo, ev, head, apv] as const;
export const AREA_EN = { ...account.en, ...officer.en, ...goals.en, ...performance.en, ...settings.en, ...work.en, ...marketing.en, ...pages.en, ...home.en, ...run.en, ...orch.en, ...cost.en, ...xa.en, ...bi.en, ...org.en, ...ogo.en, ...ev.en, ...head.en, ...apv.en };
export const AREA_NL = { ...account.nl, ...officer.nl, ...goals.nl, ...performance.nl, ...settings.nl, ...work.nl, ...marketing.nl, ...pages.nl, ...home.nl, ...run.nl, ...orch.nl, ...cost.nl, ...xa.nl, ...bi.nl, ...org.nl, ...ogo.nl, ...ev.nl, ...head.nl, ...apv.nl };
export const AREA_FR = { ...account.fr, ...officer.fr, ...goals.fr, ...performance.fr, ...settings.fr, ...work.fr, ...marketing.fr, ...pages.fr, ...home.fr, ...run.fr, ...orch.fr, ...cost.fr, ...xa.fr, ...bi.fr, ...org.fr, ...ogo.fr, ...ev.fr, ...head.fr, ...apv.fr };
