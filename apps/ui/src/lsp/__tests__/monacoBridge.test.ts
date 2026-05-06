import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/lsp", () => ({
  listServerStatus: vi.fn(),
  documentChange: vi.fn().mockResolvedValue(undefined),
  documentClose: vi.fn().mockResolvedValue(undefined),
  documentOpen: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => undefined),
}));

vi.mock("../diagnosticsListener", () => ({
  attachDiagnosticsListener: vi.fn().mockReturnValue(() => undefined),
}));

vi.mock("../completionAdapter", () => ({ makeCompletionProvider: vi.fn(() => ({})) }));
vi.mock("../hoverAdapter", () => ({ makeHoverProvider: vi.fn(() => ({})) }));
vi.mock("../signatureHelpAdapter", () => ({ makeSignatureHelpProvider: vi.fn(() => ({})) }));
vi.mock("../definitionAdapter", () => ({ makeDefinitionProvider: vi.fn(() => ({})) }));
vi.mock("../referencesAdapter", () => ({ makeReferenceProvider: vi.fn(() => ({})) }));
vi.mock("../documentSymbolAdapter", () => ({ makeDocumentSymbolProvider: vi.fn(() => ({})) }));

import { listServerStatus } from "../../lib/lsp";
import { listen } from "@tauri-apps/api/event";
import { attach } from "../monacoBridge";

function makeMonacoMock() {
  const dispose = vi.fn();
  const disposable = { dispose };
  const langs = {
    registerCompletionItemProvider: vi.fn(() => disposable),
    registerHoverProvider: vi.fn(() => disposable),
    registerSignatureHelpProvider: vi.fn(() => disposable),
    registerDefinitionProvider: vi.fn(() => disposable),
    registerReferenceProvider: vi.fn(() => disposable),
    registerDocumentSymbolProvider: vi.fn(() => disposable),
  };
  return {
    mock: { languages: langs, editor: { getModel: vi.fn() } } as never,
    langs,
    dispose,
  };
}

describe("monacoBridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers only providers for declared capabilities + subscribes ready event", async () => {
    (listServerStatus as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{
      serverId: "rust-analyzer",
      languages: ["rust"],
      resolution: { kind: "found", path: "/usr/bin/rust-analyzer" },
      state: "ready",
      rssMb: null,
      capabilities: { definition: true, references: false, documentSymbol: true, workspaceSymbol: true },
    }]);
    const { mock, langs } = makeMonacoMock();
    await attach(mock);
    expect(langs.registerDefinitionProvider).toHaveBeenCalledTimes(1);
    expect(langs.registerReferenceProvider).not.toHaveBeenCalled();
    expect(langs.registerDocumentSymbolProvider).toHaveBeenCalledTimes(1);
    // Module-level guard ensures `listen` is invoked at most once across
    // all attach() calls — assert it was wired during the first attach.
    expect(listen).toHaveBeenCalledWith("lsp://server-ready", expect.any(Function));
  });

  it("skips servers in non-ready state", async () => {
    (listServerStatus as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{
      serverId: "rust-analyzer",
      languages: ["rust"],
      resolution: { kind: "found", path: "/usr/bin/rust-analyzer" },
      state: "spawning",
      rssMb: null,
      capabilities: { definition: true, references: true, documentSymbol: true, workspaceSymbol: true },
    }]);
    const { mock, langs } = makeMonacoMock();
    await attach(mock);
    expect(langs.registerDefinitionProvider).not.toHaveBeenCalled();
  });
});
