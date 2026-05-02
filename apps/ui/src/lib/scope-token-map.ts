export interface ScopeRule {
  prefix: string;
  token: string;
}

/**
 * Heuristic mapping from VS Code TextMate scopes to Monaco token names.
 * Order matters — entries are sorted longest-prefix-first so the matcher
 * returns the most specific rule.
 *
 * Validated by Spike D against VS Code Modern Dark (100% coverage on the
 * 32-scope sample). M2 may extend this table when Phase 4 dogfood reveals
 * gaps in real imported themes.
 */
export const SCOPE_TOKEN_MAP: ScopeRule[] = [
  { prefix: "comment.line.double-slash", token: "comment.line" },
  { prefix: "comment.block.documentation", token: "comment.doc" },
  { prefix: "comment", token: "comment" },
  { prefix: "string.quoted.triple", token: "string.template" },
  { prefix: "string.regexp", token: "regexp" },
  { prefix: "string", token: "string" },
  { prefix: "constant.numeric", token: "number" },
  { prefix: "constant.language", token: "constant.language" },
  { prefix: "constant.character.escape", token: "string.escape" },
  { prefix: "constant", token: "constant" },
  { prefix: "keyword.operator", token: "operator" },
  { prefix: "keyword.control", token: "keyword.control" },
  { prefix: "keyword", token: "keyword" },
  { prefix: "storage.type", token: "type.keyword" },
  { prefix: "storage.modifier", token: "keyword.modifier" },
  { prefix: "storage", token: "keyword" },
  { prefix: "entity.name.function", token: "function" },
  { prefix: "entity.name.class", token: "type.class" },
  { prefix: "entity.name.type", token: "type" },
  { prefix: "entity.name.tag", token: "tag" },
  { prefix: "entity.other.attribute-name", token: "attribute.name" },
  { prefix: "support.function", token: "function.builtin" },
  { prefix: "support.class", token: "type.builtin" },
  { prefix: "support.type", token: "type.builtin" },
  { prefix: "variable.parameter", token: "variable.parameter" },
  { prefix: "variable.language", token: "variable.predefined" },
  { prefix: "variable.other", token: "variable" },
  { prefix: "variable", token: "variable" },
  { prefix: "punctuation.definition.string", token: "string" },
  { prefix: "punctuation", token: "delimiter" },
  { prefix: "invalid", token: "invalid" },
  { prefix: "markup.heading", token: "keyword" },
  { prefix: "markup.bold", token: "strong" },
  { prefix: "markup.italic", token: "emphasis" },
];

export function longestPrefixMatch(scope: string): string {
  for (const rule of SCOPE_TOKEN_MAP) {
    if (scope === rule.prefix || scope.startsWith(rule.prefix + ".")) {
      return rule.token;
    }
  }
  return "";
}

export function ruleCount(): number {
  return SCOPE_TOKEN_MAP.length;
}
