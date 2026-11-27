import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// `text-2xs` is the project's smallest type step (src/styles.css); registering it keeps tailwind-merge from treating
// it as a colour and dropping it next to `text-muted-foreground`.
const twMerge = extendTailwindMerge({
  extend: { theme: { text: ["2xs"] } },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
