import type { Icon } from "@phosphor-icons/react";
import {
  Code, Cube, File, Function, Hash, Question,
} from "@phosphor-icons/react";
import { LspSymbolKind } from "./types";

export type IconFamily = "file" | "class" | "function" | "field" | "type" | "unknown";

export interface SymbolIconMeta {
  Icon: Icon;
  family: IconFamily;
  /** Daisu Nocturne semantic accent class — caller applies via `text-...`. */
  colorClass: string;
}

const META: Record<IconFamily, SymbolIconMeta> = {
  file:     { Icon: File,     family: "file",     colorClass: "text-daisu-fg-subtle" },
  class:    { Icon: Cube,     family: "class",    colorClass: "text-daisu-blue" },
  function: { Icon: Function, family: "function", colorClass: "text-daisu-violet" },
  field:    { Icon: Hash,     family: "field",    colorClass: "text-daisu-green" },
  type:     { Icon: Code,     family: "type",     colorClass: "text-daisu-cyan" },
  unknown:  { Icon: Question, family: "unknown",  colorClass: "text-daisu-fg-muted" },
};

const FAMILY_BY_KIND: Record<number, IconFamily> = {
  [LspSymbolKind.File]:           "file",
  [LspSymbolKind.Module]:         "file",
  [LspSymbolKind.Namespace]:      "file",
  [LspSymbolKind.Package]:        "file",
  [LspSymbolKind.Class]:          "class",
  [LspSymbolKind.Interface]:      "class",
  [LspSymbolKind.Struct]:         "class",
  [LspSymbolKind.Enum]:           "class",
  [LspSymbolKind.Method]:         "function",
  [LspSymbolKind.Function]:       "function",
  [LspSymbolKind.Constructor]:    "function",
  [LspSymbolKind.Operator]:       "function",
  [LspSymbolKind.Field]:          "field",
  [LspSymbolKind.Property]:       "field",
  [LspSymbolKind.Variable]:       "field",
  [LspSymbolKind.Constant]:       "field",
  [LspSymbolKind.EnumMember]:     "field",
  [LspSymbolKind.Event]:          "field",
  [LspSymbolKind.TypeParameter]:  "type",
  [LspSymbolKind.Array]:          "type",
  [LspSymbolKind.Object]:         "type",
  [LspSymbolKind.Key]:            "type",
};

export function iconForSymbolKind(kind: number): SymbolIconMeta {
  const family = FAMILY_BY_KIND[kind] ?? "unknown";
  return META[family];
}
