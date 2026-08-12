import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Weighted rubric scores are sums of floats, so a total lands as
 * 91.60000000000001 often enough to matter. Two decimals is finer than any
 * rubric resolves to. Display only — the stored score keeps its precision.
 */
export function formatScore(n: number): string {
  return String(Number(n.toFixed(2)))
}
