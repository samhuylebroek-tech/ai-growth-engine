import { defineArea } from "../define";

// Information labels on AI answers ("cl"): confirmed fact, calculated, estimate, hypothesis, recommendation, missing.
export const cl = defineArea("cl", {
  en: {
    "cl.fact": "Confirmed fact",
    "cl.calc": "Calculated",
    "cl.estimate": "Estimate",
    "cl.hypothesis": "Hypothesis",
    "cl.recommendation": "Recommendation",
    "cl.missing": "Missing information",
    "cl.d.fact": "Backed by a confirmed business fact or recorded data; the source is named.",
    "cl.d.calc": "Worked out from your records with the formula and period shown.",
    "cl.d.estimate": "An approximate value with its basis; not an actual result.",
    "cl.d.hypothesis": "A possible explanation or opportunity that has not been confirmed.",
    "cl.d.recommendation": "A proposed action. Nothing happens without your approval.",
    "cl.d.missing": "Information needed for a reliable answer that is not available yet.",
    "cl.downgraded": "Labelled as a fact but worded as uncertain, so shown as a hypothesis.",
    "cl.legend": "What the labels mean",
    "cl.showSupport": "Show the evidence and reasoning",
    "cl.hideSupport": "Hide the evidence and reasoning",
    "cl.inAnswer": "In this answer:",
    "cl.unlabelled":
      "This answer has no labels. Treat its statements as unverified unless a source is named.",
  },
  nl: {
    "cl.fact": "Bevestigd feit",
    "cl.calc": "Berekend",
    "cl.estimate": "Schatting",
    "cl.hypothesis": "Hypothese",
    "cl.recommendation": "Aanbeveling",
    "cl.missing": "Ontbrekende informatie",
    "cl.d.fact":
      "Gestaafd door een bevestigd bedrijfsfeit of geregistreerde gegevens; de bron staat erbij.",
    "cl.d.calc": "Berekend uit je gegevens, met de formule en periode erbij.",
    "cl.d.estimate": "Een benadering met de basis erbij; geen werkelijk resultaat.",
    "cl.d.hypothesis": "Een mogelijke verklaring of kans die nog niet bevestigd is.",
    "cl.d.recommendation": "Een voorgestelde actie. Er gebeurt niets zonder jouw goedkeuring.",
    "cl.d.missing": "Informatie die nodig is voor een betrouwbaar antwoord, maar nog ontbreekt.",
    "cl.downgraded": "Als feit gelabeld maar onzeker verwoord, daarom als hypothese getoond.",
    "cl.legend": "Wat de labels betekenen",
    "cl.showSupport": "Toon het bewijs en de redenering",
    "cl.hideSupport": "Verberg het bewijs en de redenering",
    "cl.inAnswer": "In dit antwoord:",
    "cl.unlabelled":
      "Dit antwoord heeft geen labels. Beschouw de uitspraken als niet gecontroleerd, tenzij er een bron bij staat.",
  },
  fr: {
    "cl.fact": "Fait confirmé",
    "cl.calc": "Calculé",
    "cl.estimate": "Estimation",
    "cl.hypothesis": "Hypothèse",
    "cl.recommendation": "Recommandation",
    "cl.missing": "Information manquante",
    "cl.d.fact":
      "Appuyé par un fait confirmé ou des données enregistrées ; la source est indiquée.",
    "cl.d.calc": "Calculé à partir de vos données, avec la formule et la période indiquées.",
    "cl.d.estimate": "Une valeur approximative avec sa base ; pas un résultat réel.",
    "cl.d.hypothesis": "Une explication ou opportunité possible, non confirmée.",
    "cl.d.recommendation": "Une action proposée. Rien ne se fait sans votre approbation.",
    "cl.d.missing": "Information nécessaire à une réponse fiable, pas encore disponible.",
    "cl.downgraded":
      "Indiqué comme fait mais formulé avec incertitude, donc affiché comme hypothèse.",
    "cl.legend": "Ce que signifient les étiquettes",
    "cl.showSupport": "Afficher les preuves et le raisonnement",
    "cl.hideSupport": "Masquer les preuves et le raisonnement",
    "cl.inAnswer": "Dans cette réponse :",
    "cl.unlabelled":
      "Cette réponse n'a pas d'étiquettes. Considérez ses affirmations comme non vérifiées, sauf si une source est indiquée.",
  },
});
