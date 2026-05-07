import type { LockedServer, SchemaChange, Severity } from "../core/types.js";

const RULES: Record<string, Severity> = {
  TOOL_REMOVED: "MAJOR",
  TOOL_RENAMED: "MAJOR",
  PARAM_REMOVED: "MAJOR",
  PARAM_TYPE_CHANGED: "MAJOR",
  PARAM_MADE_REQUIRED: "MAJOR",
  PARAM_CONSTRAINT_TIGHTENED: "MAJOR",
  ENUM_VALUE_REMOVED: "MAJOR",
  REQUIRED_FIELD_ADDED: "MAJOR",
  OUTPUT_TYPE_CHANGED: "MAJOR",
  OUTPUT_FIELD_REMOVED: "MAJOR",
  PARAM_REMOVED_OPTIONAL: "MINOR",
  DESCRIPTION_SEMANTICS_CHANGED: "MINOR",
  DEFAULT_VALUE_CHANGED: "MINOR",
  PARAM_CONSTRAINT_LOOSENED: "MINOR",
  ANNOTATION_CHANGED: "MINOR",
  OUTPUT_FIELD_ADDED_REQUIRED: "MINOR",
  PARAM_ADDED_OPTIONAL: "PATCH",
  TOOL_ADDED: "PATCH",
  ENUM_VALUE_ADDED: "PATCH",
  DESCRIPTION_UPDATED: "PATCH",
  OUTPUT_FIELD_ADDED_OPTIONAL: "PATCH",
  METADATA_CHANGED: "PATCH",
};

export function classifyChange(ruleId: string, overrides?: Record<string, Severity>): Severity {
  if (overrides && overrides[ruleId]) return overrides[ruleId]!;
  return RULES[ruleId] ?? "PATCH";
}

export interface DiffInput {
  oldTool: { inputSchema: Record<string, unknown> } | null;
  newTool: { name: string; description?: string; inputSchema: Record<string, unknown> } | null;
}

export function diffTool(
  toolName: string,
  oldInput: Record<string, unknown> | null,
  newInput: Record<string, unknown> | null,
  oldDesc: string | undefined,
  newDesc: string | undefined,
  ruleOverrides?: Record<string, Severity>
): SchemaChange[] {
  const changes: SchemaChange[] = [];

  if (!oldInput && newInput) {
    changes.push(makeChange("TOOL_ADDED", toolName, "", "Tool added", "Previously absent, now present", null, newInput, ruleOverrides));
    return changes;
  }
  if (oldInput && !newInput) {
    changes.push(makeChange("TOOL_REMOVED", toolName, "", "Tool removed", "Previously present, now absent", oldInput, null, ruleOverrides));
    return changes;
  }
  if (!oldInput || !newInput) return changes;

  const oldType = typeof oldInput === "object" && oldInput !== null ? (oldInput as Record<string, unknown>) : {};
  const newType = typeof newInput === "object" && newInput !== null ? (newInput as Record<string, unknown>) : {};

  const oldProps = (oldType.properties as Record<string, Record<string, unknown>>) ?? {};
  const newProps = (newType.properties as Record<string, Record<string, unknown>>) ?? {};
  const oldRequired: string[] = (oldType.required as string[]) ?? [];
  const newRequired: string[] = (newType.required as string[]) ?? [];

  for (const [prop, oldPropSchema] of Object.entries(oldProps)) {
    if (!(prop in newProps)) {
      const wasRequired = oldRequired.includes(prop);
      changes.push(makeChange(
        wasRequired ? "PARAM_REMOVED" : "PARAM_REMOVED_OPTIONAL",
        toolName, prop,
        wasRequired ? "Required parameter removed: " + prop : "Optional parameter removed: " + prop,
        "Parameter " + prop + " no longer accepted",
        oldPropSchema, null, ruleOverrides
      ));
    }
  }

  for (const [prop, newPropSchema] of Object.entries(newProps)) {
    const oldPropSchema = oldProps[prop];
    const wasRequired = oldRequired.includes(prop);
    const nowRequired = newRequired.includes(prop);

    if (!oldPropSchema) {
      changes.push(makeChange(
        nowRequired ? "REQUIRED_FIELD_ADDED" : "PARAM_ADDED_OPTIONAL",
        toolName, prop,
        nowRequired ? "New required parameter: " + prop : "New optional parameter: " + prop,
        "Parameter " + prop + " added",
        null, newPropSchema, ruleOverrides
      ));
      continue;
    }

    if (!wasRequired && nowRequired) {
      changes.push(makeChange("PARAM_MADE_REQUIRED", toolName, prop,
        "Parameter became required: " + prop,
        "Was optional, now required", oldPropSchema, newPropSchema, ruleOverrides));
    }

    const oldTypeVal = oldPropSchema.type as string;
    const newTypeVal = newPropSchema.type as string;
    if (oldTypeVal && newTypeVal && oldTypeVal !== newTypeVal) {
      changes.push(makeChange("PARAM_TYPE_CHANGED", toolName, prop,
        "Parameter type changed: " + prop + " (" + oldTypeVal + " -> " + newTypeVal + ")",
        "Type was " + oldTypeVal + ", now " + newTypeVal,
        oldPropSchema, newPropSchema, ruleOverrides));
    }

    const oldMin = oldPropSchema.minimum as number | undefined;
    const newMin = newPropSchema.minimum as number | undefined;
    if (oldMin !== undefined && newMin !== undefined && newMin > oldMin) {
      changes.push(makeChange("PARAM_CONSTRAINT_TIGHTENED", toolName, prop,
        "Constraint tightened on " + prop + ": minimum " + oldMin + " -> " + newMin,
        "Range was >= " + oldMin + ", now >= " + newMin,
        oldPropSchema, newPropSchema, ruleOverrides));
    }
    if (oldMin !== undefined && newMin !== undefined && newMin < oldMin) {
      changes.push(makeChange("PARAM_CONSTRAINT_LOOSENED", toolName, prop,
        "Constraint loosened on " + prop, "", oldPropSchema, newPropSchema, ruleOverrides));
    }
  }

  if (oldDesc !== newDesc && oldDesc && newDesc) {
    changes.push(makeChange("DESCRIPTION_UPDATED", toolName, "",
      "Description updated for " + toolName, "", oldDesc, newDesc, ruleOverrides));
  }

  return changes;
}

function makeChange(
  ruleId: string, tool: string, field: string,
  summary: string, detail: string,
  before: unknown, after: unknown,
  overrides?: Record<string, Severity>
): SchemaChange {
  return { ruleId, severity: classifyChange(ruleId, overrides), tool, field, summary, detail, before, after };
}
