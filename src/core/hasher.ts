import { createHash } from "node:crypto";
import stringify from "fast-json-stable-stringify";
import type { LockedTool } from "./types.js";

export function hashSchema(schema: Record<string, unknown> | null | undefined): string {
  const canonical = stringify(schema ?? {});
  return createHash("sha256").update(canonical).digest("hex");
}

export function hashTool(tool: LockedTool): string {
  const canonical = stringify({
    description: tool.description ?? "",
    inputSchema: tool.inputSchema ?? {},
    outputSchema: tool.outputSchema ?? null,
    annotations: tool.annotations ?? {},
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}
