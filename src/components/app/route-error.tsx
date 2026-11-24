import { useEffect } from "react";
import { useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { RefreshCw, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { readLocale } from "@/lib/i18n";
import { reportLovableError } from "@/lib/lovable-error-reporting";
import { isModuleLoadError, retryPageLoad } from "@/lib/module-load-error";

const COPY = {
  en: {
    title: "This page didn't load",
    message: "Something went wrong. Try again or return home.",
    module:
      "A required part of this page couldn't be downloaded. Check your connection and reload the page.",
    retry: "Try again",
    reload: "Reload page",
    home: "Go home",
  },
  nl: {
    title: "Deze pagina kon niet laden",
    message: "Er ging iets mis. Probeer opnieuw of ga terug naar de startpagina.",
    module:
      "Een benodigd deel van deze pagina kon niet worden gedownload. Controleer je verbinding en laad de pagina opnieuw.",
    retry: "Probeer opnieuw",
    reload: "Pagina opnieuw laden",
    home: "Naar de startpagina",
  },
  fr: {
    title: "Cette page n’a pas pu se charger",
    message: "Une erreur s’est produite. Réessayez ou revenez à l’accueil.",
    module:
      "Une partie nécessaire de cette page n’a pas pu être téléchargée. Vérifiez votre connexion et rechargez la page.",
    retry: "Réessayer",
    reload: "Recharger la page",
    home: "Retour à l’accueil",
  },
};

/** Eagerly imported by the router: recovery must not depend on the chunk that failed. */
export function RouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  const copy = COPY[readLocale()];
  const moduleError = isModuleLoadError(error);
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_route_error_component" });
  }, [error]);

  return (
    <div role="alert" className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold text-foreground">{copy.title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {moduleError ? copy.module : copy.message}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button
            onClick={() => {
              void retryPageLoad(error, {
                reload: () => window.location.reload(),
                invalidate: () => router.invalidate(),
                reset,
              }).catch(() => {});
            }}
          >
            <RefreshCw /> {moduleError ? copy.reload : copy.retry}
          </Button>
          <Button variant="outline" asChild>
            <a href="/">
              <Home /> {copy.home}
            </a>
          </Button>
        </div>
      </div>
    </div>
  );
}
