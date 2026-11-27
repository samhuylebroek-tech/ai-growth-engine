// Vite config for the sandbox-only staging app (started by scripts/staging/app.ts, never by the platform).
// Separate port and dependency cache so the regular preview server is not disturbed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: { server: { entry: "server" } },
  vite: {
    cacheDir: "node_modules/.vite-staging",
    server: {
      port: 8091,
      strictPort: true,
      host: "127.0.0.1",
      hmr: false,
      watch: { ignored: ["**/drizzle/**", "**/docs/**", "**/scripts/**"] },
    },
  },
});
