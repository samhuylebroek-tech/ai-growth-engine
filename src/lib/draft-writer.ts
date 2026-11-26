/** Serializes draft writes so an older request cannot overwrite a newer edit after transport reordering. */
export function createDraftWriter<T>(persist: (draft: T) => Promise<void>) {
  let queue: Promise<void> = Promise.resolve();
  return (draft: T) => {
    const result = queue.then(() => persist(draft));
    // A failed write must not poison the queue: a deliberate retry still reaches persistence.
    queue = result.catch(() => {});
    return result;
  };
}
