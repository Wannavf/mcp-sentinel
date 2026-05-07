import type { Severity, CompatibilityMode, SchemaChange } from "../core/types.js";

export function filterByCompatibility(
  changes: SchemaChange[],
  mode: CompatibilityMode
): SchemaChange[] {
  if (mode === "NONE") return changes;

  return changes.filter((c) => {
    switch (mode) {
      case "STRICT":
        return true;
      case "BACKWARD":
        return !isBackwardCompatible(c);
      case "FORWARD":
        return !isForwardCompatible(c);
      case "FULL":
        return !isBackwardCompatible(c) || !isForwardCompatible(c);
      default:
        return true;
    }
  });
}

function isBackwardCompatible(change: SchemaChange): boolean {
  const additive = [
    "PARAM_ADDED_OPTIONAL", "TOOL_ADDED", "ENUM_VALUE_ADDED",
    "DESCRIPTION_UPDATED", "OUTPUT_FIELD_ADDED_OPTIONAL", "METADATA_CHANGED",
  ];
  return additive.includes(change.ruleId);
}

function isForwardCompatible(change: SchemaChange): boolean {
  const forward = [
    "TOOL_ADDED", "ENUM_VALUE_ADDED", "DESCRIPTION_UPDATED",
    "OUTPUT_FIELD_ADDED_OPTIONAL", "METADATA_CHANGED",
  ];
  return forward.includes(change.ruleId);
}

export function severityFromChanges(changes: SchemaChange[]): Severity {
  if (changes.length === 0) return "PATCH";
  if (changes.some((c) => c.severity === "MAJOR")) return "MAJOR";
  if (changes.some((c) => c.severity === "MINOR")) return "MINOR";
  return "PATCH";
}
