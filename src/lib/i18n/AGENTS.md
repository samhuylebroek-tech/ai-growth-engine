# Interface text

- Interface text lives in `src/lib/i18n/` (core keys in `messages.ts`, screen areas in `areas/<area>.ts` with keys prefixed `<area>.`; en reference; nl/fr must define every key, type-checked and tested); the locale is a cookie read identically on server and client to avoid hydration mismatches.
- Tab titles use `localHead(key)` with `head.<key>.*` texts and registry names go through `registry-text.ts`, so no page shows fixed English.
