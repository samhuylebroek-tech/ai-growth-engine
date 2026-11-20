import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { useRouter } from "@tanstack/react-router";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getCookie, getRequestHeader } from "@tanstack/react-start/server";
import { LOCALE_TAG, resolveLocale, translate, type Locale, type MessageKey } from "./messages";

export const LOCALE_COOKIE = "ago_lang";

/** Same answer on the server (cookie/header) and in the browser (cookie), so rendering never mismatches. */
export const readLocale = createIsomorphicFn()
  .server((): Locale =>
    resolveLocale(getCookie(LOCALE_COOKIE), getRequestHeader("accept-language")),
  )
  .client((): Locale => {
    const m = document.cookie.match(new RegExp(`(?:^|; )${LOCALE_COOKIE}=([a-z]{2})`));
    return resolveLocale(m?.[1], document.documentElement.lang || navigator.language);
  });

type I18n = {
  locale: Locale;
  tag: string;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  setLocale: (l: Locale) => void;
};
const Ctx = createContext<I18n | null>(null);

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const router = useRouter();
  const setLocale = useCallback(
    (l: Locale) => {
      document.cookie = `${LOCALE_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax${location.protocol === "https:" ? "; secure" : ""}`;
      document.documentElement.lang = l;
      void router.invalidate();
    },
    [router],
  );
  const value = useMemo<I18n>(
    () => ({
      locale,
      tag: LOCALE_TAG[locale],
      t: (key, vars) => translate(locale, key, vars),
      setLocale,
    }),
    [locale, setLocale],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const FALLBACK: I18n = {
  locale: "en",
  tag: LOCALE_TAG.en,
  t: (key, vars) => translate("en", key, vars),
  setLocale: () => {},
};
/** Outside the provider (isolated component tests) this falls back to English. */
export function useI18n(): I18n {
  return useContext(Ctx) ?? FALLBACK;
}
