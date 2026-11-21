import { createStart, createCsrfMiddleware, createMiddleware } from "@tanstack/react-start";

import { setResponseHeader } from "@tanstack/react-start/server";
import { renderErrorPage } from "./lib/error-page";
import { checkRuntimeEnvironment } from "./lib/environment";
import { bodyLimitRefusal } from "./lib/request-limits";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// Refuses to serve when a declared environment (APP_ENVIRONMENT) is mixed with another project's
// settings, and keeps staging out of search engines. No-op when APP_ENVIRONMENT is not set.
const environmentMiddleware = createMiddleware().server(async ({ next }) => {
  const check = checkRuntimeEnvironment(process.env);
  if (check.problems.length) {
    console.error(`[environment] refusing to serve: ${check.problems.join("; ")}`);
    return new Response(
      "<!doctype html><title>Unavailable</title><p>This environment is not configured correctly and is switched off.</p>",
      {
        status: 503,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "x-robots-tag": "noindex, nofollow",
          "cache-control": "no-store",
        },
      },
    );
  }
  if (check.environment === "staging") setResponseHeader("X-Robots-Tag", "noindex, nofollow");
  return next();
});

// Refuses oversized request bodies before any parsing or validation (see src/lib/request-limits.ts).
const bodyLimitMiddleware = createMiddleware().server(async ({ next, request, handlerType }) => {
  const refusal = bodyLimitRefusal(request.method, request.headers, handlerType);
  if (refusal) return new Response(refusal.reason, { status: refusal.status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  return next();
});

// Start installs this automatically when src/start.ts is absent; defining the
// file opts out, so re-add it explicitly to keep server functions protected
// from cross-site requests.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

// requestMiddleware runs on every request; functionMiddleware only on server functions, where
// client sendContext is unvalidated input. Append to these arrays, never replace them.
// Enabling Lovable Cloud adds functionMiddleware: [attachSupabaseAuth], the bearer token that
// requireSupabaseAuth server functions need. Add it by hand only if Lovable Cloud or a
// user-managed Supabase project is connected, no middleware here sets Authorization, and the
// project did not intentionally replace it.
export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth],
  requestMiddleware: [errorMiddleware, environmentMiddleware, bodyLimitMiddleware, csrfMiddleware],
}));
