# Financial rules (canonical)

Every money figure on every screen, report, Home alert and Growth Officer context comes from the same reader
(`src/lib/econ/read.ts`) and the pure rules in `src/lib/econ/` and `src/lib/org/`. This file states those rules.

## Formulas (per currency, per period)
| Figure | Rule |
| --- | --- |
| Gross revenue | Sum of recorded sales (manual or imported) whose sale date is in the period. Estimated sales are shown apart. |
| Refunds | Refunds, cancellations and corrections linked to a sale, counted in the month of that sale (also when issued later). |
| Net revenue | Gross revenue − refunds. |
| Business costs | Recorded business cost entries (after their own corrections) whose cost period lies inside the report period. Estimated and simulated costs are shown apart. |
| Cost of goods / gross profit | Net revenue − cost of goods under the cost model in force for the whole period; withheld (with the missing input) when costs are missing, the model changes inside the period, or a cost period crosses the report period. |
| Gross margin | Gross profit ÷ net revenue × 100, only when gross profit exists and net revenue > 0. |
| Campaign spending | Actual spend and correction entries of the campaign ledger. Reservations are not spending; simulated entries never count; budget allocations are budget, not spending. |
| AI cost | Each credit at the credit price version in effect when it was used (plan price before platform price). Credits used when no price applied stay credits. Pending charges and unknown outcomes are listed, never valued. The value is the customer-facing credit price, not the platform's infrastructure cost. |
| CAC | Actual acquisition spending ÷ new customers (first sale in the period with a customer reference). Leads are never customers. |
| ROAS | Revenue attributed to the campaign by the chosen attribution model ÷ the campaign's actual spending, same period. |
| Revenue per customer | Net revenue ÷ distinct customer references with recorded sales. |
| Budget remaining / utilization | Planned budget lines − active allocations (unallocated); actual spending ÷ allocation. |

## Counting once
Task → campaign → initiative → strategy/goal → business: an amount has one home (campaign ledger, business cost ledger
or the AI credit of a campaign task). A parent adds its own direct costs and each linked campaign once
(`rollup.ts`, `creditAtoms`). Business AI totals come from the usage ledger; credits not linked to a campaign are shown
as other AI work, never spread over campaigns.

## Currencies
Amounts are never added across currencies. The organization view converts month by month: each month at its closing
rate — the latest stored rate on or before the month's last day (today for the current month), at most 7 days older,
official ECB before manual on the same day, ECB cross rate via the euro when both euro rates exist for that day. A
month without a rate keeps its original amount and the converted total is withheld with the reason. A converted
figure is shown only when the business's months add up to its period figure. ECB rates are stored by the server only
(daily, or the 90-day history on request) and are permanent.
The same conversion is reused, never re-implemented, on Home (only when the period has more than one currency or a
currency other than the business's reporting currency) and in the Growth Officer's context (current month; labelled as
a reporting view, gross profit not converted, withheld with the reason when a rate is missing).
