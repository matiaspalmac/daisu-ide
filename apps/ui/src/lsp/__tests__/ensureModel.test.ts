import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/tauri", () => ({
  openFile: vi.fn(),
}));

import { openFile } from "../../api/tauri";
import { ensureModel } from "../ensureModel";

function makeMonacoMock() {
  const getModel = vi.fn();
  const createModel = vi.fn();
  return {
    editor: { getModel, createModel },
    Uri: {
      parse: (s: string) => ({
        toString: () => s,
        fsPath: s.replace(/^file:\/\//, ""),
      }),
    },
  };
}

describe("ensureModel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips when model already exists", async () => {
    const m = makeMonacoMock();
    m.editor.getModel.mockReturnValueOnce({});
    await ensureModel(m as never, m.Uri.parse("file:///a.ts") as never);
    expect(openFile).not.toHaveBeenCalled();
  });

  it("creates model from openFile result when missing", async () => {
    const m = makeMonacoMock();
    m.editor.getModel.mockReturnValueOnce(null);
    (openFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      contents: "const x = 1;",
      language: "typescript",
      path: "/a.ts",
    });
    await ensureModel(m as never, m.Uri.parse("file:///a.ts") as never);
    expect(m.editor.createModel).toHaveBeenCalledWith(
      "const x = 1;",
      "typescript",
      expect.anything(),
    );
  });

  it("swallows openFile errors", async () => {
    const m = makeMonacoMock();
    m.editor.getModel.mockReturnValueOnce(null);
    (openFile as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("nope"));
    await expect(
      ensureModel(m as never, m.Uri.parse("file:///gone.ts") as never),
    ).resolves.toBeUndefined();
    expect(m.editor.createModel).not.toHaveBeenCalled();
  });
});
