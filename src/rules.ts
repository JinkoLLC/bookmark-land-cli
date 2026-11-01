import { usageError } from "./errors.ts";
import type { SmartFolderRules } from "./types.ts";

// The documented Smart folder rule fields, by their CLI name (the API name in kebab-case).
const FIELDS: Record<
  string,
  { api: string; operators: string[]; value: string }
> = {
  tag: { api: "tag", operators: ["equals", "contains"], value: "a Tag name" },
  domain: {
    api: "domain",
    operators: ["equals", "contains"],
    value: "a domain",
  },
  type: {
    api: "type",
    operators: ["equals"],
    value: "link, article, image, video or document",
  },
  "is-favorite": {
    api: "isFavorite",
    operators: ["equals"],
    value: "true or false",
  },
  "created-after": {
    api: "createdAfter",
    operators: ["equals"],
    value: "a date, such as 2026-01-01",
  },
  "created-before": {
    api: "createdBefore",
    operators: ["equals"],
    value: "a date, such as 2026-01-01",
  },
  "click-count": {
    api: "clickCount",
    operators: ["gte", "lte"],
    value: "a whole number",
  },
};
const byApiName = new Map(
  Object.entries(FIELDS).map(([cli, f]) => [f.api, cli]),
);
const TYPES = ["link", "article", "image", "video", "document"];

const fieldList = () =>
  Object.entries(FIELDS)
    .map(([name, f]) => `  ${name} ${f.operators.join("|")} <${f.value}>`)
    .join("\n");

// Checks one condition in the API's format. Dates must already be epoch milliseconds.
function check(
  field: string,
  operator: string,
  value: string,
  rule: string,
  json = false,
): void {
  const cli = byApiName.get(field);
  if (!cli)
    throw usageError(
      `Unknown rule field in "${rule}". Valid rules:\n${fieldList()}`,
    );
  const spec = FIELDS[cli];
  if (!spec.operators.includes(operator)) {
    throw usageError(
      `"${cli}" rules use ${spec.operators.join(" or ")}, not "${operator}" (in "${rule}")`,
    );
  }
  if (!value)
    throw usageError(`The rule "${rule}" needs a value: ${spec.value}`);
  if (value.length > 500)
    throw usageError(
      `Rule values can be at most 500 characters (in "${cli}" rule)`,
    );
  const valid =
    field === "type"
      ? TYPES.includes(value)
      : field === "isFavorite"
        ? value === "true" || value === "false"
        : field === "clickCount" || field.startsWith("created")
          ? /^\d+$/.test(value)
          : true;
  const expected =
    json && field.startsWith("created")
      ? 'milliseconds since 1970, as a string such as "1767225600000"'
      : spec.value;
  if (!valid) throw usageError(`The value in "${rule}" must be ${expected}`);
}

function checkCount(rules: SmartFolderRules): SmartFolderRules {
  const n = rules.conditions.length;
  if (n < 1 || n > 10)
    throw usageError(`A Smart folder needs 1 to 10 rules (got ${n})`);
  return rules;
}

// "<field> <operator> <value>", with readable field names and dates; the value may contain spaces.
export function parseRules(rules: string[], match = "all"): SmartFolderRules {
  if (match !== "all" && match !== "any")
    throw usageError("--match must be all or any");
  const conditions = rules.map((rule) => {
    const [, cli = "", operator = "", raw = ""] =
      /^\s*(\S+)\s+(\S+)\s+(.*?)\s*$/.exec(rule) ?? [];
    const spec = FIELDS[cli];
    if (!spec)
      throw usageError(
        `Can't read the rule "${rule}". Valid rules:\n${fieldList()}`,
      );
    let value = raw;
    if (spec.api.startsWith("created")) {
      const ms = Date.parse(raw);
      if (Number.isNaN(ms))
        throw usageError(`The value in "${rule}" must be ${spec.value}`);
      value = String(ms);
    }
    check(spec.api, operator, value, rule);
    return { field: spec.api, operator, value };
  });
  return checkCount({ match, conditions });
}

// Rules in the API's own JSON format, for agents.
export function checkRulesJson(text: string): SmartFolderRules {
  let rules: SmartFolderRules;
  try {
    rules = JSON.parse(text);
  } catch (err) {
    throw usageError(
      `--rules-json isn't valid JSON: ${(err as Error).message}`,
    );
  }
  if (
    !rules ||
    (rules.match !== "all" && rules.match !== "any") ||
    !Array.isArray(rules.conditions)
  ) {
    throw usageError(
      '--rules-json must look like {"match": "all", "conditions": [{"field", "operator", "value"}]}',
    );
  }
  for (const c of rules.conditions) {
    check(
      typeof c?.field === "string" ? c.field : "",
      typeof c?.operator === "string" ? c.operator : "",
      typeof c?.value === "string" ? c.value : "",
      JSON.stringify(c),
      true,
    );
  }
  return checkCount(rules);
}

// The readable form of a rule, for tables and `show`.
export function describeRules(rules: SmartFolderRules): string {
  const parts = rules.conditions.map(({ field, operator, value }) => {
    const iso =
      field.startsWith("created") && new Date(Number(value)).toISOString();
    const shown = iso ? iso.replace("T00:00:00.000Z", "") : value;
    return `${byApiName.get(field) ?? field} ${operator} ${shown}`;
  });
  return parts.join(rules.match === "any" ? " or " : " and ");
}
