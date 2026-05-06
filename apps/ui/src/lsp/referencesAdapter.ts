import type * as monaco from "monaco-editor";
import { lspReferences } from "../lib/lsp";
import { ensureModel } from "./ensureModel";
import { flushPendingChange, pathOfModel } from "./monacoBridge";
import { lspRangeToMonaco } from "./positions";

const REFS_CAP = 200;

export function makeReferenceProvider(
  monacoNs: typeof import("monaco-editor"),
  serverId: string,
): monaco.languages.ReferenceProvider {
  return {
    async provideReferences(model, position, context, token) {
      const path = pathOfModel(model);
      if (!path) return null;
      await flushPendingChange(path).catch(() => undefined);
      const refs = await lspReferences(
        path,
        position.lineNumber - 1,
        position.column - 1,
        context.includeDeclaration,
        serverId,
      ).catch(() => []);
      if (token.isCancellationRequested) return null;
      const limited = refs.slice(0, REFS_CAP);
      await Promise.all(
        limited.map((r) => ensureModel(monacoNs, monacoNs.Uri.parse(r.uri))),
      );
      if (token.isCancellationRequested) return null;
      return limited.map((r) => ({
        uri: monacoNs.Uri.parse(r.uri),
        range: lspRangeToMonaco(r.range),
      }));
    },
  };
}
