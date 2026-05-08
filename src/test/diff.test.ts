import assert from "node:assert/strict";
import test from "node:test";
import { diffTool } from "../diff/rules.js";

test("detects required fields added as MAJOR", () => {
  const changes = diffTool(
    "create_issue",
    { type: "object", properties: {}, required: [] },
    {
      type: "object",
      properties: { title: { type: "string" } },
      required: ["title"],
    },
    undefined,
    undefined
  );

  assert.equal(changes.length, 1);
  assert.equal(changes[0]?.ruleId, "REQUIRED_FIELD_ADDED");
  assert.equal(changes[0]?.severity, "MAJOR");
});

test("detects optional fields added as PATCH", () => {
  const changes = diffTool(
    "search",
    { type: "object", properties: {}, required: [] },
    {
      type: "object",
      properties: { limit: { type: "number" } },
      required: [],
    },
    undefined,
    undefined
  );

  assert.equal(changes.length, 1);
  assert.equal(changes[0]?.ruleId, "PARAM_ADDED_OPTIONAL");
  assert.equal(changes[0]?.severity, "PATCH");
});

test("detects tightened minimum as MAJOR", () => {
  const changes = diffTool(
    "charge",
    {
      type: "object",
      properties: { amount: { type: "number", minimum: 0 } },
      required: ["amount"],
    },
    {
      type: "object",
      properties: { amount: { type: "number", minimum: 1 } },
      required: ["amount"],
    },
    undefined,
    undefined
  );

  assert.equal(changes.some((change) => change.ruleId === "PARAM_CONSTRAINT_TIGHTENED"), true);
});
