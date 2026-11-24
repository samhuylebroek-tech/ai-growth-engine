/** Only missing JavaScript modules need a new document; ordinary data errors can retry in place. */
export function isModuleLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Failed to load module script|Loading chunk [\w-]+ failed|ChunkLoadError/i.test(
    `${error.name}: ${error.message}`,
  );
}

export async function retryPageLoad(
  error: unknown,
  actions: { reload: () => void; invalidate: () => Promise<unknown>; reset: () => void },
): Promise<void> {
  if (isModuleLoadError(error)) {
    // Import failures are cached by the browser. Resetting the route cannot fetch a new manifest.
    actions.reload();
    return;
  }
  await actions.invalidate();
  actions.reset();
}
