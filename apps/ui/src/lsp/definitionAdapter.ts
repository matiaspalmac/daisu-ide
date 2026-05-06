import type * as monaco from "monaco-editor";
import { lspDefinition } from "../lib/lsp";
import { ensureModel } from "./ensureModel";
import { flushPendingChange, pathOfModel } from "./monacoBridge";
import { lspRangeToMonaco } from "./positions";
import type {
  LspGotoDefinitionResponse,
  LspLocation,
  LspLocationLink,
} from "./types";

export function makeDefinitionProvider(
  monacoNs: typeof import("monaco-editor"),
  serverId: string,
): monaco.languages.DefinitionProvider {
  return {
    async provideDefinition(model, position, token) {
      const path = pathOfModel(model);
      if (!path) return null;
      await flushPendingChange(path).catch(() => undefined);
      const result = await lspDefinition(
        path,
        position.lineNumber - 1,
        position.column - 1,
        serverId,
      ).catch(() => null);
      if (!result || token.isCancellationRequested) return null;
      const links = normalizeDefinitionResponse(result, monacoNs);
      // Pre-load target models so the peek widget can render cross-file
      // definitions even when the user never opened the target file.
      await Promise.all(links.map((l) => ensureModel(monacoNs, l.uri)));
      if (token.isCancellationRequested) return null;
      return links;
    },
  };
}

function normalizeDefinitionResponse(
  r: LspGotoDefinitionResponse,
  monacoNs: typeof import("monaco-editor"),
): monaco.languages.LocationLink[] {
  // Single Location scalar (older servers).
  if (!Array.isArray(r) && "uri" in r && "range" in r) {
    return [{ uri: monacoNs.Uri.parse(r.uri), range: lspRangeToMonaco(r.range) }];
  }
  if (!Array.isArray(r) || r.length === 0) return [];
  return r.map((item) => {
    if (isLocationLink(item)) {
      const link: monaco.languages.LocationLink = {
        uri: monacoNs.Uri.parse(item.targetUri),
        range: lspRangeToMonaco(item.targetSelectionRange ?? item.targetRange),
      };
      if (item.originSelectionRange) {
        link.originSelectionRange = lspRangeToMonaco(item.originSelectionRange);
      }
      return link;
    }
    return { uri: monacoNs.Uri.parse(item.uri), range: lspRangeToMonaco(item.range) };
  });
}

function isLocationLink(x: LspLocation | LspLocationLink): x is LspLocationLink {
  return "targetUri" in x;
}
