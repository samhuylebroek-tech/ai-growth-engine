// Option labels for onboarding answers in every language, so a saved answer is read back whatever language the
// person uses now. Texts live in i18n area "ob".
import { ob } from "@/lib/i18n/areas/ob";
import type { LabelOf, LabelsOf } from "@/lib/onboarding/answers";
import type { Locale } from "@/lib/i18n/messages";

type Table = Record<string, string>;
const TABLES: Record<Locale, Table> = { en: ob.en as Table, nl: ob.nl as Table, fr: ob.fr as Table };

export const optionKey = (questionId: string, option: string) => `ob.o.${questionId}.${option}`;
export const labelsOf: LabelsOf = (q, o) => Object.values(TABLES).map((t) => t[optionKey(q, o)] ?? o);
export const labelIn = (locale: Locale): LabelOf => (q, o) => TABLES[locale][optionKey(q, o)] ?? TABLES.en[optionKey(q, o)] ?? o;
