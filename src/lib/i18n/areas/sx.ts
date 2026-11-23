import { defineArea } from "../define";
import type { SignalCode } from "@/lib/signals";

// Plain-language explanation for every Command Center warning ("sx"): why it matters, what to do, and what happens
// if nothing is done. EXPLAINED is a Record over every SignalCode, so a new warning cannot ship without its explanation.
export const EXPLAINED: Record<SignalCode, true> = {
  initiative_outcome_conflict: true,
  initiative_outcome_missing: true,
  goal_metric_conflict: true,
  metric_missing_month: true,
  goal_stale: true,
  seo_stale: true,
  deals_overdue: true,
  deals_stale: true,
  budget_over_cap: true,
  budget_over_plan: true,
  metric_ahead: true,
  no_measurement: true,
  tasks_overdue: true,
  tasks_blocked: true,
  initiative_behind: true,
  runs_failing: true,
  runs_waiting: true,
  runs_uncertain: true,
  facts_conflict: true,
  campaign_budget_over: true,
  campaign_budget_near: true,
  campaign_emergency_stop: true,
  campaign_limit_reached: true,
  campaign_spend_forecast: true,
  replan_pending: true,
  econ_allocation_exceeded: true,
  econ_allocation_near: true,
  econ_budget_unallocated: true,
  econ_budget_duplicates: true,
  econ_request_rejected: true,
  econ_cost_model_missing: true,
  econ_cost_missing: true,
  econ_customer_missing: true,
  econ_attribution_missing: true,
  econ_margin_declining: true,
  econ_price_missing: true,
  recommendation_measure_due: true,
};

export const sx = defineArea("sx", {
  en: {
    "sx.why": "Why it matters:",
    "sx.do": "What you can do:",
    "sx.ifNothing": "If nothing is done:",
    "sx.ai": "The Growth Officer can help you work out the next step.",
    "sx.more": "Explain",
    "sx.initiative_outcome_conflict.why":
      "The plan and the measured results tell different stories, so decisions may rest on the wrong picture.",
    "sx.initiative_outcome_conflict.do": "Check which figure is right and correct the other one.",
    "sx.initiative_outcome_conflict.if":
      "The Growth Officer and reports keep working with two versions of the truth.",
    "sx.initiative_outcome_missing.why":
      "Without a measured outcome nobody can tell whether this work paid off.",
    "sx.initiative_outcome_missing.do": "Record the result, or link a metric that measures it.",
    "sx.initiative_outcome_missing.if": "The initiative stays “done” without proof that it helped.",
    "sx.goal_metric_conflict.why":
      "The goal and its metric show different values, so progress is unclear.",
    "sx.goal_metric_conflict.do":
      "Decide which value is right and update the goal or the measurement.",
    "sx.goal_metric_conflict.if": "Progress reports and advice can contradict each other.",
    "sx.metric_missing_month.why": "A missing month makes trends and comparisons unreliable.",
    "sx.metric_missing_month.do":
      "Record the result for that month, even if it is an estimate marked as such.",
    "sx.metric_missing_month.if": "Changes over time cannot be judged fairly.",
    "sx.goal_stale.why": "An old goal may no longer reflect what the business wants.",
    "sx.goal_stale.do": "Confirm the goal is still right, update it, or close it.",
    "sx.goal_stale.if": "Plans and advice keep aiming at an outdated target.",
    "sx.seo_stale.why": "Your website may have changed since the last check.",
    "sx.seo_stale.do": "Run a new website check.",
    "sx.seo_stale.if": "Website advice is based on old information.",
    "sx.deals_overdue.why":
      "Deals past their close date often mean a lost sale or a forgotten follow-up.",
    "sx.deals_overdue.do": "Contact the customer, update the expected date, or mark the deal lost.",
    "sx.deals_overdue.if": "Your pipeline looks bigger than it really is.",
    "sx.deals_stale.why": "Deals nobody has touched for two months are probably cooling down.",
    "sx.deals_stale.do": "Follow up on them or close them.",
    "sx.deals_stale.if": "Forecasts keep counting deals that may already be gone.",
    "sx.budget_over_cap.why": "Spending went above the hard limit you set for this channel.",
    "sx.budget_over_cap.do": "Pause new spending on this channel and check the entries.",
    "sx.budget_over_cap.if": "You may spend more money than you agreed to.",
    "sx.budget_over_plan.why": "This channel costs more than planned this month.",
    "sx.budget_over_plan.do": "Check whether the extra spending brings results, or lower it.",
    "sx.budget_over_plan.if": "The monthly budget runs out sooner than expected.",
    "sx.metric_ahead.why":
      "Something is working better than planned — worth understanding and repeating.",
    "sx.metric_ahead.do":
      "Find out what caused it and consider raising the target or doing more of it.",
    "sx.metric_ahead.if": "A chance to grow faster may be missed.",
    "sx.no_measurement.why":
      "Without a number to follow, nobody can tell whether a goal is getting closer.",
    "sx.no_measurement.do":
      "Add one simple metric per goal, for example the number of new customers per month.",
    "sx.no_measurement.if": "Progress stays a matter of opinion.",
    "sx.tasks_overdue.why": "Late tasks delay everything that depends on them.",
    "sx.tasks_overdue.do": "Finish them, give them a new date, or drop what is no longer needed.",
    "sx.tasks_overdue.if": "Campaigns and goals slip further behind.",
    "sx.tasks_blocked.why": "These tasks cannot really start until earlier work is finished.",
    "sx.tasks_blocked.do":
      "Open the task to see what holds it up, then finish or re-plan the earlier task.",
    "sx.tasks_blocked.if": "The waiting tasks — and everything after them — move later.",
    "sx.initiative_behind.why":
      "The initiative is later than planned, which can push back the goal.",
    "sx.initiative_behind.do": "Check what is holding it up and adjust the plan if needed.",
    "sx.initiative_behind.if": "The goal date becomes unrealistic.",
    "sx.runs_failing.why": "AI work that keeps failing uses time and may use credits.",
    "sx.runs_failing.do": "Look at the error, adjust the task description, or do it by hand.",
    "sx.runs_failing.if": "The task stays unfinished.",
    "sx.runs_waiting.why": "AI work is ready but needs a person to approve it before it continues.",
    "sx.runs_waiting.do": "Review and approve or reject it.",
    "sx.runs_waiting.if": "The work stays on hold.",
    "sx.runs_uncertain.why":
      "It is not certain whether this AI work finished; the credits stay reserved.",
    "sx.runs_uncertain.do": "Check the result and close it as finished or failed.",
    "sx.runs_uncertain.if": "Credits stay reserved and the task stays unclear.",
    "sx.facts_conflict.why":
      "Two confirmed facts about your business disagree, so advice may use the wrong one.",
    "sx.facts_conflict.do": "Choose which fact is right; both stay in the history.",
    "sx.facts_conflict.if": "The Growth Officer keeps seeing contradictory information.",
    "sx.campaign_budget_over.why": "The campaign spent more than its budget.",
    "sx.campaign_budget_over.do": "Pause spending or approve a higher budget on purpose.",
    "sx.campaign_budget_over.if": "Costs keep rising without an agreed limit.",
    "sx.campaign_budget_near.why": "The campaign has almost used its budget.",
    "sx.campaign_budget_near.do": "Decide whether to stop at the budget or add money.",
    "sx.campaign_budget_near.if": "The campaign may stop or overspend unexpectedly.",
    "sx.campaign_emergency_stop.why":
      "All new spending on this campaign is blocked until someone lifts the stop.",
    "sx.campaign_emergency_stop.do": "Check why the stop was raised, then lift it or keep it.",
    "sx.campaign_emergency_stop.if": "The campaign cannot spend money.",
    "sx.campaign_limit_reached.why":
      "A spending limit is (almost) reached; new entries above it are refused.",
    "sx.campaign_limit_reached.do": "Decide whether the limit should stay or be raised.",
    "sx.campaign_limit_reached.if": "Planned spending may be refused.",
    "sx.campaign_spend_forecast.why":
      "At the current pace the campaign may go over its total limit. This is an estimate.",
    "sx.campaign_spend_forecast.do": "Lower the daily spending or adjust the limit.",
    "sx.campaign_spend_forecast.if": "The limit may be reached before the campaign ends.",
    "sx.replan_pending.why":
      "A proposal to move deadlines is waiting; until then the planning stays out of order.",
    "sx.replan_pending.do": "Open it and accept, postpone or reject it.",
    "sx.replan_pending.if": "Late and blocked work stays as it is.",
    "sx.econ_allocation_exceeded.why":
      "More was actually spent than was assigned to this campaign or channel.",
    "sx.econ_allocation_exceeded.do": "Check the entries and move budget on purpose if needed.",
    "sx.econ_allocation_exceeded.if": "Money is used without being assigned.",
    "sx.econ_allocation_near.why": "Most of the assigned money is used.",
    "sx.econ_allocation_near.do": "Decide whether to add budget or slow down.",
    "sx.econ_allocation_near.if": "Work may stop when the allocation runs out.",
    "sx.econ_budget_unallocated.why":
      "Part of this month’s budget is not assigned to any campaign or channel.",
    "sx.econ_budget_unallocated.do": "Assign it, or keep it aside on purpose.",
    "sx.econ_budget_unallocated.if": "Money may be left unused while campaigns run short.",
    "sx.econ_budget_duplicates.why":
      "Some budget lines look the same, so money may be counted twice.",
    "sx.econ_budget_duplicates.do": "Check them and archive the duplicates.",
    "sx.econ_budget_duplicates.if": "Budget totals can be too high.",
    "sx.econ_request_rejected.why":
      "Budget requests were refused, so planned work may not get money.",
    "sx.econ_request_rejected.do": "Read why they were refused and adjust the plan.",
    "sx.econ_request_rejected.if": "Planned work may stall.",
    "sx.econ_cost_model_missing.why":
      "Without your costs, profit cannot be calculated — only revenue.",
    "sx.econ_cost_model_missing.do": "Enter your main costs, such as purchase or delivery costs.",
    "sx.econ_cost_model_missing.if":
      "Decisions rest on revenue alone, not on what you actually earn.",
    "sx.econ_cost_missing.why": "Some costs are missing, so profit would look better than it is.",
    "sx.econ_cost_missing.do": "Add the missing costs for this period.",
    "sx.econ_cost_missing.if": "Profit figures stay incomplete.",
    "sx.econ_customer_missing.why":
      "Sales without a customer cannot be used to count new or returning customers.",
    "sx.econ_customer_missing.do": "Add the customer to these sales where you know it.",
    "sx.econ_customer_missing.if": "Customer cost and customer value stay unknown.",
    "sx.econ_attribution_missing.why":
      "Sales not linked to a campaign cannot show which campaigns bring money.",
    "sx.econ_attribution_missing.do":
      "Link sales to the campaign or channel that brought them, where you know it.",
    "sx.econ_attribution_missing.if": "Campaign results stay unclear.",
    "sx.econ_margin_declining.why": "You keep less of each sale than before.",
    "sx.econ_margin_declining.do": "Check whether costs rose or prices dropped.",
    "sx.econ_margin_declining.if": "Growth may bring less profit.",
    "sx.econ_price_missing.why": "Without a credit price, AI work cannot be shown in money.",
    "sx.econ_price_missing.do": "Nothing for you to do; the platform owner sets credit prices.",
    "sx.econ_price_missing.if": "AI costs stay shown in credits only.",
    "sx.recommendation_measure_due.why":
      "Enough time has passed to see whether these recommendations worked.",
    "sx.recommendation_measure_due.do": "Record the result so the system can learn from it.",
    "sx.recommendation_measure_due.if": "Future advice cannot learn what worked.",
  },
  nl: {
    "sx.why": "Waarom dit belangrijk is:",
    "sx.do": "Wat je kunt doen:",
    "sx.ifNothing": "Als er niets gebeurt:",
    "sx.ai": "De Growth Officer kan je helpen de volgende stap uit te werken.",
    "sx.more": "Uitleg",
    "sx.initiative_outcome_conflict.why":
      "Het plan en de gemeten resultaten vertellen iets anders, dus beslissingen kunnen op een verkeerd beeld rusten.",
    "sx.initiative_outcome_conflict.do": "Controleer welk cijfer klopt en corrigeer het andere.",
    "sx.initiative_outcome_conflict.if":
      "De Growth Officer en rapporten blijven met twee versies van de waarheid werken.",
    "sx.initiative_outcome_missing.why":
      "Zonder gemeten resultaat weet niemand of dit werk iets heeft opgeleverd.",
    "sx.initiative_outcome_missing.do": "Leg het resultaat vast of koppel een meetwaarde.",
    "sx.initiative_outcome_missing.if":
      "Het initiatief blijft ‘klaar’ zonder bewijs dat het geholpen heeft.",
    "sx.goal_metric_conflict.why":
      "Het doel en zijn meetwaarde tonen verschillende waarden, dus de voortgang is onduidelijk.",
    "sx.goal_metric_conflict.do": "Beslis welke waarde klopt en werk het doel of de meting bij.",
    "sx.goal_metric_conflict.if": "Voortgangsrapporten en adviezen kunnen elkaar tegenspreken.",
    "sx.metric_missing_month.why":
      "Een ontbrekende maand maakt trends en vergelijkingen onbetrouwbaar.",
    "sx.metric_missing_month.do":
      "Leg het resultaat voor die maand vast, eventueel als schatting gemarkeerd.",
    "sx.metric_missing_month.if":
      "Veranderingen door de tijd kunnen niet eerlijk beoordeeld worden.",
    "sx.goal_stale.why": "Een oud doel weerspiegelt misschien niet meer wat het bedrijf wil.",
    "sx.goal_stale.do": "Bevestig dat het doel nog klopt, werk het bij of sluit het af.",
    "sx.goal_stale.if": "Plannen en adviezen blijven op een verouderd doel mikken.",
    "sx.seo_stale.why": "Je website is sinds de laatste controle misschien veranderd.",
    "sx.seo_stale.do": "Voer een nieuwe websitecontrole uit.",
    "sx.seo_stale.if": "Websiteadvies blijft op oude informatie gebaseerd.",
    "sx.deals_overdue.why":
      "Deals voorbij hun sluitdatum betekenen vaak een verloren verkoop of vergeten opvolging.",
    "sx.deals_overdue.do":
      "Neem contact op, pas de verwachte datum aan of markeer de deal als verloren.",
    "sx.deals_overdue.if": "Je pijplijn lijkt groter dan ze echt is.",
    "sx.deals_stale.why": "Deals waar twee maanden niets mee gebeurde, koelen waarschijnlijk af.",
    "sx.deals_stale.do": "Volg ze op of sluit ze af.",
    "sx.deals_stale.if": "Prognoses blijven deals meetellen die misschien al weg zijn.",
    "sx.budget_over_cap.why":
      "De uitgaven gingen boven de harde grens die je voor dit kanaal instelde.",
    "sx.budget_over_cap.do": "Pauzeer nieuwe uitgaven op dit kanaal en controleer de boekingen.",
    "sx.budget_over_cap.if": "Je geeft mogelijk meer geld uit dan afgesproken.",
    "sx.budget_over_plan.why": "Dit kanaal kost deze maand meer dan gepland.",
    "sx.budget_over_plan.do": "Kijk of de extra uitgaven resultaat opleveren, of verlaag ze.",
    "sx.budget_over_plan.if": "Het maandbudget raakt sneller op dan verwacht.",
    "sx.metric_ahead.why":
      "Iets werkt beter dan gepland — de moeite waard om te begrijpen en te herhalen.",
    "sx.metric_ahead.do":
      "Zoek uit waardoor het komt en overweeg het doel te verhogen of er meer van te doen.",
    "sx.metric_ahead.if": "Een kans om sneller te groeien kan gemist worden.",
    "sx.no_measurement.why": "Zonder cijfer om te volgen weet niemand of een doel dichterbij komt.",
    "sx.no_measurement.do":
      "Voeg per doel één eenvoudige meetwaarde toe, bijvoorbeeld het aantal nieuwe klanten per maand.",
    "sx.no_measurement.if": "Voortgang blijft een kwestie van mening.",
    "sx.tasks_overdue.why": "Taken over tijd vertragen alles wat ervan afhangt.",
    "sx.tasks_overdue.do": "Rond ze af, geef ze een nieuwe datum of schrap wat niet meer nodig is.",
    "sx.tasks_overdue.if": "Campagnes en doelen lopen verder achter.",
    "sx.tasks_blocked.why": "Deze taken kunnen pas echt beginnen als eerder werk af is.",
    "sx.tasks_blocked.do":
      "Open de taak om te zien wat ze tegenhoudt en rond de eerdere taak af of herplan.",
    "sx.tasks_blocked.if": "De wachtende taken — en alles daarna — schuiven op.",
    "sx.initiative_behind.why":
      "Het initiatief loopt later dan gepland, wat het doel kan uitstellen.",
    "sx.initiative_behind.do": "Bekijk wat het tegenhoudt en pas het plan zo nodig aan.",
    "sx.initiative_behind.if": "De doeldatum wordt onrealistisch.",
    "sx.runs_failing.why": "AI-werk dat blijft mislukken kost tijd en mogelijk credits.",
    "sx.runs_failing.do": "Bekijk de fout, pas de taakomschrijving aan of doe het met de hand.",
    "sx.runs_failing.if": "De taak blijft onafgewerkt.",
    "sx.runs_waiting.why": "AI-werk is klaar maar wacht op goedkeuring van een persoon.",
    "sx.runs_waiting.do": "Bekijk het en keur goed of af.",
    "sx.runs_waiting.if": "Het werk blijft stilstaan.",
    "sx.runs_uncertain.why":
      "Het is niet zeker of dit AI-werk is afgerond; de credits blijven gereserveerd.",
    "sx.runs_uncertain.do": "Controleer het resultaat en sluit het af als gelukt of mislukt.",
    "sx.runs_uncertain.if": "Credits blijven gereserveerd en de taak blijft onduidelijk.",
    "sx.facts_conflict.why":
      "Twee bevestigde feiten over je bedrijf spreken elkaar tegen, dus advies kan het verkeerde gebruiken.",
    "sx.facts_conflict.do": "Kies welk feit klopt; beide blijven in de geschiedenis.",
    "sx.facts_conflict.if": "De Growth Officer blijft tegenstrijdige informatie zien.",
    "sx.campaign_budget_over.why": "De campagne gaf meer uit dan haar budget.",
    "sx.campaign_budget_over.do": "Pauzeer de uitgaven of keur bewust een hoger budget goed.",
    "sx.campaign_budget_over.if": "De kosten blijven stijgen zonder afgesproken grens.",
    "sx.campaign_budget_near.why": "De campagne heeft haar budget bijna op.",
    "sx.campaign_budget_near.do": "Beslis of je bij het budget stopt of geld bijzet.",
    "sx.campaign_budget_near.if": "De campagne kan onverwacht stoppen of te veel uitgeven.",
    "sx.campaign_emergency_stop.why":
      "Alle nieuwe uitgaven voor deze campagne zijn geblokkeerd tot iemand de stop opheft.",
    "sx.campaign_emergency_stop.do":
      "Kijk waarom de stop werd ingesteld en hef hem op of laat hem staan.",
    "sx.campaign_emergency_stop.if": "De campagne kan geen geld uitgeven.",
    "sx.campaign_limit_reached.why":
      "Een uitgavengrens is (bijna) bereikt; nieuwe boekingen erboven worden geweigerd.",
    "sx.campaign_limit_reached.do": "Beslis of de grens blijft of omhoog moet.",
    "sx.campaign_limit_reached.if": "Geplande uitgaven kunnen geweigerd worden.",
    "sx.campaign_spend_forecast.why":
      "Aan het huidige tempo kan de campagne over haar totale grens gaan. Dit is een schatting.",
    "sx.campaign_spend_forecast.do": "Verlaag de dagelijkse uitgaven of pas de grens aan.",
    "sx.campaign_spend_forecast.if": "De grens kan bereikt worden vóór de campagne afloopt.",
    "sx.replan_pending.why":
      "Een voorstel om deadlines te verschuiven wacht; tot dan klopt de planning niet.",
    "sx.replan_pending.do": "Open het en aanvaard, stel uit of wijs af.",
    "sx.replan_pending.if": "Laat en geblokkeerd werk blijft zoals het is.",
    "sx.econ_allocation_exceeded.why":
      "Er werd meer uitgegeven dan aan deze campagne of dit kanaal was toegewezen.",
    "sx.econ_allocation_exceeded.do":
      "Controleer de boekingen en verschuif zo nodig bewust budget.",
    "sx.econ_allocation_exceeded.if": "Er wordt geld gebruikt zonder toewijzing.",
    "sx.econ_allocation_near.why": "Het grootste deel van het toegewezen geld is op.",
    "sx.econ_allocation_near.do": "Beslis of je budget bijzet of vertraagt.",
    "sx.econ_allocation_near.if": "Werk kan stilvallen als de toewijzing op is.",
    "sx.econ_budget_unallocated.why":
      "Een deel van het maandbudget is niet aan een campagne of kanaal toegewezen.",
    "sx.econ_budget_unallocated.do": "Wijs het toe of houd het bewust apart.",
    "sx.econ_budget_unallocated.if":
      "Geld blijft mogelijk ongebruikt terwijl campagnes tekortkomen.",
    "sx.econ_budget_duplicates.why":
      "Sommige budgetregels lijken op elkaar, dus geld kan dubbel geteld worden.",
    "sx.econ_budget_duplicates.do": "Controleer ze en archiveer de dubbele.",
    "sx.econ_budget_duplicates.if": "Budgettotalen kunnen te hoog zijn.",
    "sx.econ_request_rejected.why":
      "Budgetaanvragen werden geweigerd, dus gepland werk krijgt mogelijk geen geld.",
    "sx.econ_request_rejected.do": "Lees waarom ze geweigerd werden en pas het plan aan.",
    "sx.econ_request_rejected.if": "Gepland werk kan stilvallen.",
    "sx.econ_cost_model_missing.why":
      "Zonder je kosten kan de winst niet berekend worden — alleen de omzet.",
    "sx.econ_cost_model_missing.do":
      "Voer je belangrijkste kosten in, zoals inkoop- of leveringskosten.",
    "sx.econ_cost_model_missing.if":
      "Beslissingen steunen alleen op omzet, niet op wat je echt verdient.",
    "sx.econ_cost_missing.why":
      "Sommige kosten ontbreken, waardoor de winst beter zou lijken dan ze is.",
    "sx.econ_cost_missing.do": "Voeg de ontbrekende kosten voor deze periode toe.",
    "sx.econ_cost_missing.if": "Winstcijfers blijven onvolledig.",
    "sx.econ_customer_missing.why":
      "Verkopen zonder klant tellen niet mee voor nieuwe of terugkerende klanten.",
    "sx.econ_customer_missing.do": "Voeg waar mogelijk de klant aan deze verkopen toe.",
    "sx.econ_customer_missing.if": "Klantkosten en klantwaarde blijven onbekend.",
    "sx.econ_attribution_missing.why":
      "Verkopen zonder koppeling aan een campagne tonen niet welke campagnes geld opleveren.",
    "sx.econ_attribution_missing.do":
      "Koppel verkopen aan de campagne of het kanaal dat ze opleverde, waar je dat weet.",
    "sx.econ_attribution_missing.if": "Campagneresultaten blijven onduidelijk.",
    "sx.econ_margin_declining.why": "Je houdt van elke verkoop minder over dan voorheen.",
    "sx.econ_margin_declining.do": "Kijk of de kosten stegen of de prijzen daalden.",
    "sx.econ_margin_declining.if": "Groei kan minder winst opleveren.",
    "sx.econ_price_missing.why": "Zonder creditprijs kan AI-werk niet in geld getoond worden.",
    "sx.econ_price_missing.do":
      "Je hoeft niets te doen; de platformeigenaar stelt creditprijzen in.",
    "sx.econ_price_missing.if": "AI-kosten blijven alleen in credits zichtbaar.",
    "sx.recommendation_measure_due.why":
      "Er is genoeg tijd verstreken om te zien of deze aanbevelingen werkten.",
    "sx.recommendation_measure_due.do": "Leg het resultaat vast zodat het systeem ervan kan leren.",
    "sx.recommendation_measure_due.if": "Toekomstig advies kan niet leren wat werkte.",
  },
  fr: {
    "sx.why": "Pourquoi c’est important :",
    "sx.do": "Ce que vous pouvez faire :",
    "sx.ifNothing": "Si rien n’est fait :",
    "sx.ai": "Le Growth Officer peut vous aider à définir la prochaine étape.",
    "sx.more": "Expliquer",
    "sx.initiative_outcome_conflict.why":
      "Le plan et les résultats mesurés ne disent pas la même chose : les décisions risquent de reposer sur une image fausse.",
    "sx.initiative_outcome_conflict.do": "Vérifiez quel chiffre est juste et corrigez l’autre.",
    "sx.initiative_outcome_conflict.if":
      "Le Growth Officer et les rapports continuent avec deux versions de la réalité.",
    "sx.initiative_outcome_missing.why":
      "Sans résultat mesuré, personne ne sait si ce travail a porté ses fruits.",
    "sx.initiative_outcome_missing.do":
      "Enregistrez le résultat ou liez un indicateur qui le mesure.",
    "sx.initiative_outcome_missing.if":
      "L’initiative reste « terminée » sans preuve qu’elle a aidé.",
    "sx.goal_metric_conflict.why":
      "L’objectif et son indicateur affichent des valeurs différentes : la progression n’est pas claire.",
    "sx.goal_metric_conflict.do":
      "Décidez quelle valeur est juste et mettez à jour l’objectif ou la mesure.",
    "sx.goal_metric_conflict.if": "Les rapports et les conseils peuvent se contredire.",
    "sx.metric_missing_month.why":
      "Un mois manquant rend les tendances et comparaisons peu fiables.",
    "sx.metric_missing_month.do":
      "Enregistrez le résultat de ce mois, même s’il s’agit d’une estimation signalée comme telle.",
    "sx.metric_missing_month.if": "L’évolution dans le temps ne peut pas être jugée équitablement.",
    "sx.goal_stale.why": "Un objectif ancien ne reflète peut-être plus ce que veut l’entreprise.",
    "sx.goal_stale.do": "Confirmez qu’il est toujours valable, mettez-le à jour ou clôturez-le.",
    "sx.goal_stale.if": "Les plans et conseils visent un objectif dépassé.",
    "sx.seo_stale.why": "Votre site a peut-être changé depuis la dernière vérification.",
    "sx.seo_stale.do": "Lancez une nouvelle vérification du site.",
    "sx.seo_stale.if": "Les conseils sur le site reposent sur des informations anciennes.",
    "sx.deals_overdue.why":
      "Des affaires dépassant leur date de clôture signifient souvent une vente perdue ou un suivi oublié.",
    "sx.deals_overdue.do":
      "Recontactez le client, changez la date prévue ou marquez l’affaire comme perdue.",
    "sx.deals_overdue.if": "Votre pipeline paraît plus grand qu’il ne l’est.",
    "sx.deals_stale.why": "Des affaires inactives depuis deux mois se refroidissent probablement.",
    "sx.deals_stale.do": "Relancez-les ou clôturez-les.",
    "sx.deals_stale.if": "Les prévisions comptent des affaires peut-être déjà perdues.",
    "sx.budget_over_cap.why": "Les dépenses ont dépassé la limite stricte fixée pour ce canal.",
    "sx.budget_over_cap.do":
      "Suspendez les nouvelles dépenses sur ce canal et vérifiez les écritures.",
    "sx.budget_over_cap.if": "Vous risquez de dépenser plus que prévu.",
    "sx.budget_over_plan.why": "Ce canal coûte plus que prévu ce mois-ci.",
    "sx.budget_over_plan.do": "Vérifiez si la dépense supplémentaire rapporte, ou réduisez-la.",
    "sx.budget_over_plan.if": "Le budget mensuel s’épuise plus vite que prévu.",
    "sx.metric_ahead.why":
      "Quelque chose fonctionne mieux que prévu — à comprendre et à reproduire.",
    "sx.metric_ahead.do":
      "Cherchez la cause et envisagez de relever l’objectif ou d’en faire plus.",
    "sx.metric_ahead.if": "Une occasion de croître plus vite risque d’être manquée.",
    "sx.no_measurement.why": "Sans chiffre à suivre, personne ne sait si un objectif se rapproche.",
    "sx.no_measurement.do":
      "Ajoutez un indicateur simple par objectif, par exemple le nombre de nouveaux clients par mois.",
    "sx.no_measurement.if": "La progression reste une question d’opinion.",
    "sx.tasks_overdue.why": "Les tâches en retard retardent tout ce qui en dépend.",
    "sx.tasks_overdue.do":
      "Terminez-les, donnez-leur une nouvelle date ou abandonnez ce qui n’est plus utile.",
    "sx.tasks_overdue.if": "Campagnes et objectifs prennent encore plus de retard.",
    "sx.tasks_blocked.why":
      "Ces tâches ne peuvent vraiment commencer qu’une fois le travail précédent terminé.",
    "sx.tasks_blocked.do":
      "Ouvrez la tâche pour voir ce qui la bloque, puis terminez ou replanifiez la tâche précédente.",
    "sx.tasks_blocked.if": "Les tâches en attente — et tout ce qui suit — sont décalées.",
    "sx.initiative_behind.why":
      "L’initiative est en retard sur le plan, ce qui peut repousser l’objectif.",
    "sx.initiative_behind.do": "Voyez ce qui la freine et ajustez le plan si besoin.",
    "sx.initiative_behind.if": "La date de l’objectif devient irréaliste.",
    "sx.runs_failing.why":
      "Un travail IA qui échoue sans cesse coûte du temps et parfois des crédits.",
    "sx.runs_failing.do":
      "Regardez l’erreur, ajustez la description de la tâche ou faites-la à la main.",
    "sx.runs_failing.if": "La tâche reste inachevée.",
    "sx.runs_waiting.why": "Un travail IA est prêt mais attend l’approbation d’une personne.",
    "sx.runs_waiting.do": "Examinez-le, puis approuvez ou refusez.",
    "sx.runs_waiting.if": "Le travail reste en suspens.",
    "sx.runs_uncertain.why":
      "On ne sait pas si ce travail IA s’est terminé ; les crédits restent réservés.",
    "sx.runs_uncertain.do": "Vérifiez le résultat et clôturez-le comme réussi ou échoué.",
    "sx.runs_uncertain.if": "Les crédits restent réservés et la tâche reste floue.",
    "sx.facts_conflict.why":
      "Deux faits confirmés sur votre entreprise se contredisent : les conseils risquent d’utiliser le mauvais.",
    "sx.facts_conflict.do": "Choisissez le bon fait ; les deux restent dans l’historique.",
    "sx.facts_conflict.if": "Le Growth Officer continue de voir des informations contradictoires.",
    "sx.campaign_budget_over.why": "La campagne a dépensé plus que son budget.",
    "sx.campaign_budget_over.do":
      "Suspendez les dépenses ou approuvez sciemment un budget plus élevé.",
    "sx.campaign_budget_over.if": "Les coûts continuent d’augmenter sans limite convenue.",
    "sx.campaign_budget_near.why": "La campagne a presque épuisé son budget.",
    "sx.campaign_budget_near.do": "Décidez d’arrêter au budget ou d’ajouter des fonds.",
    "sx.campaign_budget_near.if": "La campagne risque de s’arrêter ou de trop dépenser.",
    "sx.campaign_emergency_stop.why":
      "Toute nouvelle dépense sur cette campagne est bloquée jusqu’à la levée de l’arrêt.",
    "sx.campaign_emergency_stop.do":
      "Vérifiez pourquoi l’arrêt a été déclenché, puis levez-le ou maintenez-le.",
    "sx.campaign_emergency_stop.if": "La campagne ne peut rien dépenser.",
    "sx.campaign_limit_reached.why":
      "Une limite de dépense est (presque) atteinte ; les nouvelles écritures au-delà sont refusées.",
    "sx.campaign_limit_reached.do": "Décidez si la limite reste ou doit être relevée.",
    "sx.campaign_limit_reached.if": "Des dépenses prévues risquent d’être refusées.",
    "sx.campaign_spend_forecast.why":
      "Au rythme actuel, la campagne pourrait dépasser sa limite totale. C’est une estimation.",
    "sx.campaign_spend_forecast.do": "Réduisez la dépense quotidienne ou ajustez la limite.",
    "sx.campaign_spend_forecast.if":
      "La limite pourrait être atteinte avant la fin de la campagne.",
    "sx.replan_pending.why":
      "Une proposition de déplacer des échéances attend ; d’ici là, le planning reste incohérent.",
    "sx.replan_pending.do": "Ouvrez-la puis acceptez, reportez ou refusez.",
    "sx.replan_pending.if": "Le travail en retard ou bloqué reste en l’état.",
    "sx.econ_allocation_exceeded.why":
      "Les dépenses réelles dépassent l’allocation de cette campagne ou de ce canal.",
    "sx.econ_allocation_exceeded.do":
      "Vérifiez les écritures et réaffectez le budget si nécessaire.",
    "sx.econ_allocation_exceeded.if": "De l’argent est utilisé sans être affecté.",
    "sx.econ_allocation_near.why": "La majeure partie de l’argent affecté est utilisée.",
    "sx.econ_allocation_near.do": "Décidez d’ajouter du budget ou de ralentir.",
    "sx.econ_allocation_near.if": "Le travail risque de s’arrêter une fois l’allocation épuisée.",
    "sx.econ_budget_unallocated.why":
      "Une partie du budget du mois n’est affectée à aucune campagne ni canal.",
    "sx.econ_budget_unallocated.do": "Affectez-la ou gardez-la de côté volontairement.",
    "sx.econ_budget_unallocated.if":
      "De l’argent risque de rester inutilisé alors que des campagnes manquent de moyens.",
    "sx.econ_budget_duplicates.why":
      "Certaines lignes budgétaires se ressemblent : de l’argent peut être compté deux fois.",
    "sx.econ_budget_duplicates.do": "Vérifiez-les et archivez les doublons.",
    "sx.econ_budget_duplicates.if": "Les totaux budgétaires peuvent être trop élevés.",
    "sx.econ_request_rejected.why":
      "Des demandes de budget ont été refusées : le travail prévu risque de ne pas être financé.",
    "sx.econ_request_rejected.do": "Lisez pourquoi et ajustez le plan.",
    "sx.econ_request_rejected.if": "Le travail prévu risque de s’arrêter.",
    "sx.econ_cost_model_missing.why":
      "Sans vos coûts, le bénéfice ne peut pas être calculé — seulement le chiffre d’affaires.",
    "sx.econ_cost_model_missing.do":
      "Saisissez vos principaux coûts, comme l’achat ou la livraison.",
    "sx.econ_cost_model_missing.if":
      "Les décisions reposent sur le chiffre d’affaires seul, pas sur ce que vous gagnez vraiment.",
    "sx.econ_cost_missing.why": "Des coûts manquent : le bénéfice paraîtrait meilleur qu’il n’est.",
    "sx.econ_cost_missing.do": "Ajoutez les coûts manquants de cette période.",
    "sx.econ_cost_missing.if": "Les chiffres de bénéfice restent incomplets.",
    "sx.econ_customer_missing.why":
      "Les ventes sans client ne comptent pas pour les clients nouveaux ou fidèles.",
    "sx.econ_customer_missing.do": "Ajoutez le client à ces ventes quand vous le connaissez.",
    "sx.econ_customer_missing.if": "Le coût et la valeur client restent inconnus.",
    "sx.econ_attribution_missing.why":
      "Les ventes non liées à une campagne ne montrent pas quelles campagnes rapportent.",
    "sx.econ_attribution_missing.do":
      "Liez les ventes à la campagne ou au canal d’origine quand vous le savez.",
    "sx.econ_attribution_missing.if": "Les résultats des campagnes restent flous.",
    "sx.econ_margin_declining.why": "Vous gardez moins de chaque vente qu’auparavant.",
    "sx.econ_margin_declining.do": "Vérifiez si les coûts ont augmenté ou les prix baissé.",
    "sx.econ_margin_declining.if": "La croissance risque de rapporter moins.",
    "sx.econ_price_missing.why":
      "Sans prix du crédit, le travail IA ne peut pas être exprimé en argent.",
    "sx.econ_price_missing.do":
      "Rien à faire de votre côté ; le propriétaire de la plateforme fixe les prix.",
    "sx.econ_price_missing.if": "Les coûts IA restent affichés en crédits uniquement.",
    "sx.recommendation_measure_due.why":
      "Assez de temps s’est écoulé pour voir si ces recommandations ont marché.",
    "sx.recommendation_measure_due.do":
      "Enregistrez le résultat pour que le système en tire des leçons.",
    "sx.recommendation_measure_due.if":
      "Les conseils futurs ne peuvent pas apprendre ce qui a marché.",
  },
});
