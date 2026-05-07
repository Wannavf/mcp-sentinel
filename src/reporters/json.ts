import type { DiffResult } from "../core/types.js";

export function reportJson(results: DiffResult[]): string {
  return JSON.stringify(results, null, 2);
}
