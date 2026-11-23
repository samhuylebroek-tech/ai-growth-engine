import { defineArea } from "../define";

// Browser tab titles and page descriptions, per route. Keys start with "head.".
export const head = defineArea("head", {
  en: {
    "head.home.t": "AI Growth Engine",
    "head.home.d":
      "Your business growth workspace: confirmed knowledge, evidence-aware AI strategy and actions you control.",
    "head.costs.t": "Costs & ROI",
    "head.costs.d":
      "AI credits per goal, plan, initiative, campaign, project, task and specialist, kept separate from marketing budgets and revenue.",
    "head.economics.t": "Growth economics",
    "head.economics.d":
      "Budget, spending, costs, AI credits, revenue and profit of your business, without mixing actual, estimated and simulated figures.",
    "head.invite.t": "Join organization",
    "head.invite.d": "Accept your verified invitation.",
    "head.activity.t": "Activity and results",
    "head.activity.d":
      "Workspace history of AI assignments, documents, decisions and recorded results.",
    "head.workspace.t": "Workspace",
    "head.workspace.d": "Your business growth workspace.",
    "head.campaigns.t": "Campaigns",
    "head.campaigns.d": "Internal campaign planning, audiences, budgets, content and approvals.",
    "head.actions.t": "External actions",
    "head.actions.d":
      "Prepare, approve, execute and verify actions on connected platforms, each traced from task to verified result.",
    "head.organization.t": "Organization command center",
    "head.organization.d":
      "The Organization Growth Officer, cross-business opportunities, shared initiatives, resource allocation, risks and decisions across all your businesses.",
    "head.tasks.t": "Tasks",
    "head.tasks.d": "Personal and team tasks, deadlines, dependencies and calendar planning.",
    "head.approvals.t": "Approvals",
    "head.approvals.d": "Review growth actions and track decisions.",
    "head.competitors.t": "Competitors",
    "head.competitors.d":
      "Track competitors' public websites with dated, sourced observations and turn them into tasks and briefs.",
    "head.goals.t": "Goals & budget",
    "head.goals.d": "Measurable business goals and the marketing budget planned to reach them.",
    "head.owner.t": "Owner center",
    "head.owner.d": "Restricted platform administration.",
    "head.documents.t": "Documents",
    "head.documents.d": "Private documents and evidence extraction.",
    "head.command.t": "Business command center",
    "head.command.d":
      "Your workspace activity, active AI assignments, decisions and growth opportunities in one place.",
    "head.content.t": "Content Studio",
    "head.content.d":
      "Write, version, compare and approve each exact content version with writing profiles.",
    "head.modules.t": "Growth areas",
    "head.modules.d": "Strategy, marketing, sales, website and measurement availability.",
    "head.intelligence.t": "Growth intelligence",
    "head.intelligence.d":
      "Your confirmed business context, potential opportunities and strategic priorities.",
    "head.metric.t": "Metric details",
    "head.metric.d":
      "Monthly plan, estimate and result for one metric, with its full correction history and links to goals and initiatives.",
    "head.notifications.t": "Notifications",
    "head.notifications.d":
      "Workspace deadlines, decisions, recent AI results and connection failures.",
    "head.settings.t": "Organization settings",
    "head.settings.d": "Manage workspaces, invitations and team.",
    "head.performance.t": "Performance",
    "head.performance.d":
      "Track planned, forecast and actual results per metric and month, with permanent correction history.",
    "head.business.t": "Business performance",
    "head.business.d":
      "Revenue, attribution, growth indicators, comparisons and next best growth actions, each with its source, period and data quality.",
    "head.google.t": "Connecting Google data source",
    "head.google.d": "Finishing a read-only Google Analytics or Search Console connection.",
    "head.experiments.t": "Experiments",
    "head.experiments.d":
      "Plan, approve, run and conclude growth experiments, with evidence strength that separates correlation from cause.",
    "head.opportunities.t": "Growth opportunities",
    "head.opportunities.d":
      "Revenue opportunities across marketing, sales, retention, partnerships, events, pricing and product, scored and evidence-labelled for your decision.",
    "head.agents.t": "Agents and capabilities",
    "head.agents.d": "Growth specialists and available capabilities.",
    "head.seo.t": "SEO",
    "head.seo.d": "Check your public website pages for search basics and turn findings into tasks.",
    "head.reports.t": "Business reports",
    "head.reports.d":
      "Weekly, monthly, financial, campaign, AI execution and experiment reports from recorded data, with the previous period and what is missing.",
    "head.revenue.t": "Revenue & attribution",
    "head.revenue.d":
      "Record sales, refunds and corrections, link them to campaigns and channels, and compare attribution models without double counting.",
    "head.integrations.t": "Data sources",
    "head.integrations.d": "Available research sources and integration configuration.",
    "head.projects.t": "Projects",
    "head.projects.d": "Workspace projects, milestones, teams and execution progress.",
    "head.officer.t": "Growth Officer",
    "head.officer.d": "Evidence-aware conversations and recommendations.",
    "head.pipeline.t": "Sales pipeline",
    "head.pipeline.d":
      "Contacts and deals by stage, with open and won value from the deals you enter.",
    "head.improvements.t": "Improvements",
    "head.improvements.d":
      "Improvement proposals from recorded performance, with evidence, approved by an administrator and turned into tracked work.",
    "head.signin.t": "Sign in",
    "head.signin.d": "Sign in or create your AI Growth Engine account.",
    "head.reset.t": "Set a new password",
    "head.reset.d": "Choose a new password for your account.",
    "head.pricing.t": "Pricing",
    "head.pricing.d":
      "Simple plans for businesses, agencies and enterprises. Start with a 14-day free trial.",
  },
  nl: {
    "head.home.t": "AI Growth Engine",
    "head.home.d":
      "Je werkruimte voor bedrijfsgroei: bevestigde kennis, AI-strategie die bewijs respecteert en acties die jij beheert.",
    "head.costs.t": "Kosten & rendement",
    "head.costs.d":
      "AI-credits per doel, plan, initiatief, campagne, project, taak en specialist, apart van marketingbudgetten en omzet.",
    "head.economics.t": "Groei-economie",
    "head.economics.d":
      "Budget, uitgaven, kosten, AI-credits, omzet en winst van je bedrijf, zonder werkelijke, geschatte en gesimuleerde cijfers te mengen.",
    "head.invite.t": "Lid worden van de organisatie",
    "head.invite.d": "Aanvaard je geverifieerde uitnodiging.",
    "head.activity.t": "Activiteit en resultaten",
    "head.activity.d":
      "Geschiedenis van AI-opdrachten, documenten, beslissingen en vastgelegde resultaten in deze werkruimte.",
    "head.workspace.t": "Werkruimte",
    "head.workspace.d": "Je werkruimte voor bedrijfsgroei.",
    "head.campaigns.t": "Campagnes",
    "head.campaigns.d":
      "Interne campagneplanning, doelgroepen, budgetten, content en goedkeuringen.",
    "head.actions.t": "Externe acties",
    "head.actions.d":
      "Acties op gekoppelde platformen voorbereiden, goedkeuren, uitvoeren en controleren, elk gevolgd van taak tot geverifieerd resultaat.",
    "head.organization.t": "Commandocentrum van de organisatie",
    "head.organization.d":
      "De Organization Growth Officer, kansen over bedrijven heen, gedeelde initiatieven, middelen, risico's en beslissingen voor al je bedrijven.",
    "head.tasks.t": "Taken",
    "head.tasks.d": "Persoonlijke en teamtaken, deadlines, afhankelijkheden en kalenderplanning.",
    "head.approvals.t": "Goedkeuringen",
    "head.approvals.d": "Groeiacties beoordelen en beslissingen opvolgen.",
    "head.competitors.t": "Concurrenten",
    "head.competitors.d":
      "Volg de publieke websites van concurrenten met gedateerde, onderbouwde waarnemingen en maak er taken en briefings van.",
    "head.goals.t": "Doelen & budget",
    "head.goals.d": "Meetbare bedrijfsdoelen en het marketingbudget dat ervoor gepland is.",
    "head.owner.t": "Eigenaarscentrum",
    "head.owner.d": "Afgeschermd platformbeheer.",
    "head.documents.t": "Documenten",
    "head.documents.d": "Privédocumenten en extractie van bewijs.",
    "head.command.t": "Commandocentrum",
    "head.command.d":
      "Activiteit, lopende AI-opdrachten, beslissingen en groeikansen van je werkruimte op één plek.",
    "head.content.t": "Contentstudio",
    "head.content.d":
      "Schrijf, versieer, vergelijk en keur elke exacte contentversie goed met schrijfprofielen.",
    "head.modules.t": "Groeidomeinen",
    "head.modules.d": "Beschikbaarheid van strategie, marketing, verkoop, website en meting.",
    "head.intelligence.t": "Groei-inzicht",
    "head.intelligence.d":
      "Je bevestigde bedrijfscontext, mogelijke kansen en strategische prioriteiten.",
    "head.metric.t": "Details van de meting",
    "head.metric.d":
      "Maandelijks plan, schatting en resultaat voor één meting, met volledige correctiegeschiedenis en koppelingen naar doelen en initiatieven.",
    "head.notifications.t": "Meldingen",
    "head.notifications.d":
      "Deadlines, beslissingen, recente AI-resultaten en verbindingsfouten in je werkruimte.",
    "head.settings.t": "Organisatie-instellingen",
    "head.settings.d": "Werkruimtes, uitnodigingen en team beheren.",
    "head.performance.t": "Prestaties",
    "head.performance.d":
      "Volg geplande, verwachte en werkelijke resultaten per meting en maand, met blijvende correctiegeschiedenis.",
    "head.business.t": "Bedrijfsprestaties",
    "head.business.d":
      "Omzet, attributie, groei-indicatoren, vergelijkingen en volgende beste acties, elk met bron, periode en datakwaliteit.",
    "head.google.t": "Google-gegevensbron koppelen",
    "head.google.d": "Een alleen-lezen koppeling met Google Analytics of Search Console afronden.",
    "head.experiments.t": "Experimenten",
    "head.experiments.d":
      "Groei-experimenten plannen, goedkeuren, uitvoeren en afsluiten, met bewijskracht die samenhang van oorzaak onderscheidt.",
    "head.opportunities.t": "Groeikansen",
    "head.opportunities.d":
      "Omzetkansen in marketing, verkoop, klantbehoud, partnerschappen, events, prijzen en product, gescoord en met bewijslabels voor jouw beslissing.",
    "head.agents.t": "Agenten en mogelijkheden",
    "head.agents.d": "Groeispecialisten en beschikbare mogelijkheden.",
    "head.seo.t": "SEO",
    "head.seo.d": "Controleer je publieke webpagina's op zoekbasics en maak van bevindingen taken.",
    "head.reports.t": "Bedrijfsrapporten",
    "head.reports.d":
      "Week-, maand-, financiële, campagne-, AI-uitvoerings- en experimentrapporten uit geregistreerde gegevens, met de vorige periode en wat ontbreekt.",
    "head.revenue.t": "Omzet & attributie",
    "head.revenue.d":
      "Verkopen, terugbetalingen en correcties vastleggen, koppelen aan campagnes en kanalen, en attributiemodellen vergelijken zonder dubbeltellingen.",
    "head.integrations.t": "Gegevensbronnen",
    "head.integrations.d": "Beschikbare onderzoeksbronnen en configuratie van koppelingen.",
    "head.projects.t": "Projecten",
    "head.projects.d": "Projecten, mijlpalen, teams en voortgang in je werkruimte.",
    "head.officer.t": "Growth Officer",
    "head.officer.d": "Gesprekken en aanbevelingen die bewijs respecteren.",
    "head.pipeline.t": "Verkooppijplijn",
    "head.pipeline.d":
      "Contacten en deals per fase, met open en gewonnen waarde uit de deals die je invoert.",
    "head.improvements.t": "Verbeteringen",
    "head.improvements.d":
      "Verbetervoorstellen op basis van vastgelegde prestaties, met bewijs, goedgekeurd door een beheerder en omgezet in opgevolgd werk.",
    "head.signin.t": "Aanmelden",
    "head.signin.d": "Meld je aan of maak je AI Growth Engine-account aan.",
    "head.reset.t": "Nieuw wachtwoord instellen",
    "head.reset.d": "Kies een nieuw wachtwoord voor je account.",
    "head.pricing.t": "Prijzen",
    "head.pricing.d":
      "Eenvoudige abonnementen voor bedrijven, bureaus en ondernemingen. Start met 14 dagen gratis proberen.",
  },
  fr: {
    "head.home.t": "AI Growth Engine",
    "head.home.d":
      "Votre espace de croissance : connaissances confirmées, stratégie IA fondée sur des preuves et actions que vous contrôlez.",
    "head.costs.t": "Coûts et ROI",
    "head.costs.d":
      "Crédits IA par objectif, plan, initiative, campagne, projet, tâche et spécialiste, séparés des budgets marketing et du chiffre d'affaires.",
    "head.economics.t": "Économie de la croissance",
    "head.economics.d":
      "Budget, dépenses, coûts, crédits IA, chiffre d'affaires et marge de votre entreprise, sans mélanger chiffres réels, estimés et simulés.",
    "head.invite.t": "Rejoindre l'organisation",
    "head.invite.d": "Acceptez votre invitation vérifiée.",
    "head.activity.t": "Activité et résultats",
    "head.activity.d":
      "Historique des missions IA, documents, décisions et résultats enregistrés de l'espace de travail.",
    "head.workspace.t": "Espace de travail",
    "head.workspace.d": "Votre espace de croissance.",
    "head.campaigns.t": "Campagnes",
    "head.campaigns.d":
      "Planification interne des campagnes, audiences, budgets, contenus et approbations.",
    "head.actions.t": "Actions externes",
    "head.actions.d":
      "Préparer, approuver, exécuter et vérifier des actions sur les plateformes connectées, chacune suivie de la tâche au résultat vérifié.",
    "head.organization.t": "Centre de pilotage de l'organisation",
    "head.organization.d":
      "L'Organization Growth Officer, opportunités transversales, initiatives partagées, allocation des ressources, risques et décisions pour toutes vos entreprises.",
    "head.tasks.t": "Tâches",
    "head.tasks.d": "Tâches personnelles et d'équipe, échéances, dépendances et planification.",
    "head.approvals.t": "Approbations",
    "head.approvals.d": "Examiner les actions de croissance et suivre les décisions.",
    "head.competitors.t": "Concurrents",
    "head.competitors.d":
      "Suivez les sites publics des concurrents avec des observations datées et sourcées, et transformez-les en tâches et briefs.",
    "head.goals.t": "Objectifs et budget",
    "head.goals.d": "Objectifs mesurables et budget marketing prévu pour les atteindre.",
    "head.owner.t": "Centre propriétaire",
    "head.owner.d": "Administration restreinte de la plateforme.",
    "head.documents.t": "Documents",
    "head.documents.d": "Documents privés et extraction de preuves.",
    "head.command.t": "Centre de pilotage",
    "head.command.d":
      "Activité, missions IA en cours, décisions et opportunités de croissance de votre espace au même endroit.",
    "head.content.t": "Studio de contenu",
    "head.content.d":
      "Rédigez, versionnez, comparez et approuvez chaque version exacte avec des profils d'écriture.",
    "head.modules.t": "Domaines de croissance",
    "head.modules.d":
      "Disponibilité de la stratégie, du marketing, des ventes, du site web et de la mesure.",
    "head.intelligence.t": "Intelligence de croissance",
    "head.intelligence.d":
      "Votre contexte confirmé, vos opportunités potentielles et vos priorités stratégiques.",
    "head.metric.t": "Détails de l'indicateur",
    "head.metric.d":
      "Plan, estimation et résultat mensuels d'un indicateur, avec tout l'historique des corrections et les liens vers objectifs et initiatives.",
    "head.notifications.t": "Notifications",
    "head.notifications.d":
      "Échéances, décisions, résultats IA récents et échecs de connexion de l'espace de travail.",
    "head.settings.t": "Paramètres de l'organisation",
    "head.settings.d": "Gérer les espaces de travail, les invitations et l'équipe.",
    "head.performance.t": "Performance",
    "head.performance.d":
      "Suivez les résultats prévus, estimés et réels par indicateur et par mois, avec un historique permanent des corrections.",
    "head.business.t": "Performance de l’entreprise",
    "head.business.d":
      "Chiffre d'affaires, attribution, indicateurs, comparaisons et prochaines meilleures actions, chacun avec sa source, sa période et sa qualité.",
    "head.google.t": "Connexion d'une source Google",
    "head.google.d":
      "Finalisation d'une connexion en lecture seule à Google Analytics ou Search Console.",
    "head.experiments.t": "Expériences",
    "head.experiments.d":
      "Planifier, approuver, mener et conclure des expériences, avec une force de preuve qui distingue corrélation et cause.",
    "head.opportunities.t": "Opportunités de croissance",
    "head.opportunities.d":
      "Opportunités de revenus en marketing, ventes, fidélisation, partenariats, événements, prix et produit, notées et étiquetées selon leurs preuves.",
    "head.agents.t": "Agents et capacités",
    "head.agents.d": "Spécialistes de la croissance et capacités disponibles.",
    "head.seo.t": "SEO",
    "head.seo.d":
      "Vérifiez les bases du référencement de vos pages publiques et transformez les constats en tâches.",
    "head.reports.t": "Rapports d’activité",
    "head.reports.d":
      "Rapports hebdomadaires, mensuels, financiers, de campagne, d’exécution IA et d’expériences à partir des données enregistrées, avec la période précédente et ce qui manque.",
    "head.revenue.t": "Chiffre d'affaires et attribution",
    "head.revenue.d":
      "Enregistrez ventes, remboursements et corrections, reliez-les aux campagnes et canaux, et comparez les modèles d'attribution sans double comptage.",
    "head.integrations.t": "Sources de données",
    "head.integrations.d": "Sources de recherche disponibles et configuration des intégrations.",
    "head.projects.t": "Projets",
    "head.projects.d": "Projets, jalons, équipes et avancement de l'espace de travail.",
    "head.officer.t": "Growth Officer",
    "head.officer.d": "Conversations et recommandations fondées sur des preuves.",
    "head.pipeline.t": "Pipeline commercial",
    "head.pipeline.d":
      "Contacts et affaires par étape, avec la valeur ouverte et gagnée des affaires que vous saisissez.",
    "head.improvements.t": "Améliorations",
    "head.improvements.d":
      "Propositions d'amélioration fondées sur la performance enregistrée, avec preuves, approuvées par un administrateur et transformées en travail suivi.",
    "head.signin.t": "Connexion",
    "head.signin.d": "Connectez-vous ou créez votre compte AI Growth Engine.",
    "head.reset.t": "Définir un nouveau mot de passe",
    "head.reset.d": "Choisissez un nouveau mot de passe pour votre compte.",
    "head.pricing.t": "Tarifs",
    "head.pricing.d":
      "Des offres simples pour entreprises, agences et grands comptes. Commencez par 14 jours d'essai gratuit.",
  },
});
