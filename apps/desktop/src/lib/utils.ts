import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// DeerFlow-inspired utility shape, adapted for Ora desktop under MIT-compatible local use.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
