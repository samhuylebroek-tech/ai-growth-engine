import { defineArea } from "../define";

// Interface texts for rate limits ("lim"). Keys start with "lim.".
export const lim = defineArea("lim", {
  en: {
    "lim.user": "You have reached the limit for {what}. You can try again in {wait}.",
    "lim.workspace": "This business has reached its limit for {what}. You can try again in {wait}.",
    "lim.organization":
      "Your organization has reached its limit for {what}. You can try again in {wait}.",
    "lim.failures":
      "There were too many failed attempts in a short time. To protect your account, {what} is paused for {wait}.",
    "lim.what.ai": "AI requests",
    "lim.what.upload": "uploads",
    "lim.what.seo": "website checks",
    "lim.what.connect": "connecting data sources",
    "lim.wait.seconds": "less than a minute",
    "lim.wait.minute": "1 minute",
    "lim.wait.minutes": "{n} minutes",
    "lim.wait.hours": "about {n} hours",
    "lim.noCredits": "No credits were used for this request.",
    "lim.err.noCredits": "Not enough AI credits left this period.",
    "lim.err.active":
      "This request started less than 15 minutes ago. Try closing it again a little later; nothing is charged.",
    "lim.err.busy":
      "Another AI request of yours is still open. Under “Unfinished AI requests” you can close it 15 minutes after it began, at no cost.",
    "lim.unavailable": "Usage limits could not be checked right now. Try again in a moment.",
  },
  nl: {
    "lim.user": "Je hebt de limiet voor {what} bereikt. Je kunt het over {wait} opnieuw proberen.",
    "lim.workspace":
      "Dit bedrijf heeft de limiet voor {what} bereikt. Je kunt het over {wait} opnieuw proberen.",
    "lim.organization":
      "Je organisatie heeft de limiet voor {what} bereikt. Je kunt het over {wait} opnieuw proberen.",
    "lim.failures":
      "Er waren te veel mislukte pogingen in korte tijd. Om je account te beschermen staan {what} {wait} op pauze.",
    "lim.what.ai": "AI-aanvragen",
    "lim.what.upload": "uploads",
    "lim.what.seo": "websitecontroles",
    "lim.what.connect": "koppelingen met gegevensbronnen",
    "lim.wait.seconds": "minder dan een minuut",
    "lim.wait.minute": "1 minuut",
    "lim.wait.minutes": "{n} minuten",
    "lim.wait.hours": "ongeveer {n} uur",
    "lim.noCredits": "Voor deze aanvraag zijn geen credits gebruikt.",
    "lim.err.noCredits": "Er zijn deze periode niet genoeg AI-credits meer over.",
    "lim.err.active":
      "Deze aanvraag is minder dan 15 minuten geleden gestart. Probeer haar iets later opnieuw af te sluiten; er wordt niets aangerekend.",
    "lim.err.busy":
      "Er staat nog een AI-aanvraag van jou open. Onder “Onvoltooide AI-verzoeken” kun je die 15 minuten na de start kosteloos afsluiten.",
    "lim.unavailable":
      "De gebruikslimieten konden nu niet gecontroleerd worden. Probeer het zo opnieuw.",
  },
  fr: {
    "lim.user": "Vous avez atteint la limite pour {what}. Vous pourrez réessayer dans {wait}.",
    "lim.workspace":
      "Cette entreprise a atteint sa limite pour {what}. Vous pourrez réessayer dans {wait}.",
    "lim.organization":
      "Votre organisation a atteint sa limite pour {what}. Vous pourrez réessayer dans {wait}.",
    "lim.failures":
      "Trop de tentatives ont échoué en peu de temps. Pour protéger votre compte, {what} sont en pause pendant {wait}.",
    "lim.what.ai": "les demandes IA",
    "lim.what.upload": "les envois de fichiers",
    "lim.what.seo": "les vérifications de site",
    "lim.what.connect": "les connexions de sources de données",
    "lim.wait.seconds": "moins d’une minute",
    "lim.wait.minute": "1 minute",
    "lim.wait.minutes": "{n} minutes",
    "lim.wait.hours": "environ {n} heures",
    "lim.noCredits": "Aucun crédit n’a été utilisé pour cette demande.",
    "lim.err.noCredits": "Il ne reste plus assez de crédits IA pour cette période.",
    "lim.err.active":
      "Cette demande a démarré il y a moins de 15 minutes. Réessayez de la clôturer un peu plus tard ; rien n’est facturé.",
    "lim.err.busy":
      "Une autre demande IA est encore ouverte. Sous « Demandes d’IA non terminées », vous pouvez la clôturer sans frais 15 minutes après son début.",
    "lim.unavailable":
      "Les limites d’utilisation n’ont pas pu être vérifiées. Réessayez dans un instant.",
  },
});
