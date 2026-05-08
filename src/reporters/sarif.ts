import type { DiffResult, SchemaChange } from "../core/types.js";

export function reportSarif(results: DiffResult[]): string {
  const rules = results.flatMap((r) =>
    r.changes.map((c) => ({
      id: c.ruleId,
      shortDescription: { text: c.summary },
      fullDescription: { text: c.detail },
      helpUri: "https://github.com/Wannavf/mcp-sentinel/blob/main/docs/rules.md#" + c.ruleId,
      properties: { severity: c.severity },
    }))
  );

  const uniqueRules = Array.from(new Map(rules.map((r) => [r.id, r])).values());

  const results_ = results.flatMap((r) =>
    r.changes.map((c) => ({
      ruleId: c.ruleId,
      ruleIndex: uniqueRules.findIndex((u) => u.id === c.ruleId),
      message: { text: r.server + "/" + c.tool + ": " + c.summary },
      level: c.severity === "MAJOR" ? "error" : c.severity === "MINOR" ? "warning" : "note",
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: "sentinel-lock.json" },
            region: { snippet: { text: JSON.stringify(c.before ?? c.after, null, 2).slice(0, 200) } },
          },
        },
      ],
    }))
  );

  const sarif = {
    version: "2.1.0",
    schema: "https://json.schemastore.org/sarif-2.1.0.json",
    runs: [
      {
        tool: {
          driver: {
            name: "MCP Sentinel",
            informationUri: "https://github.com/Wannavf/mcp-sentinel",
            version: "0.1.0",
            rules: uniqueRules,
          },
        },
        results: results_,
      },
    ],
  };

  return JSON.stringify(sarif, null, 2);
}
