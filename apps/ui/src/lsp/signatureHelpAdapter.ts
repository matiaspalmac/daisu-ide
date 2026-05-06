import type * as monaco from "monaco-editor";
import { lspSignatureHelp, type LspSignatureHelp } from "../lib/lsp";
import { pathOfModel } from "./monacoBridge";

function toMonacoSignatureHelp(
  s: LspSignatureHelp,
): monaco.languages.SignatureHelpResult {
  const signatures: monaco.languages.SignatureInformation[] = s.signatures.map((sig) => {
    const out: monaco.languages.SignatureInformation = {
      label: sig.label,
      parameters: (sig.parameters ?? []).map((p) => {
        const param: monaco.languages.ParameterInformation = { label: p.label };
        const doc =
          typeof p.documentation === "string" ? p.documentation : p.documentation?.value;
        if (doc !== undefined) param.documentation = doc;
        return param;
      }),
    };
    const sigDoc =
      typeof sig.documentation === "string" ? sig.documentation : sig.documentation?.value;
    if (sigDoc !== undefined) out.documentation = sigDoc;
    return out;
  });
  return {
    value: {
      signatures,
      activeSignature: s.activeSignature ?? 0,
      activeParameter: s.activeParameter ?? 0,
    },
    dispose() {
      /* no-op */
    },
  };
}

export function makeSignatureHelpProvider(
  serverId: string,
): monaco.languages.SignatureHelpProvider {
  return {
    signatureHelpTriggerCharacters: ["(", ","],
    async provideSignatureHelp(model, position) {
      const path = pathOfModel(model);
      if (!path) return null;
      const s = await lspSignatureHelp(
        path,
        position.lineNumber - 1,
        position.column - 1,
        serverId,
      );
      return s ? toMonacoSignatureHelp(s) : null;
    },
  };
}
