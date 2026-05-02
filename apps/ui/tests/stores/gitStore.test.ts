import { describe, expect, it, beforeEach } from "vitest";
import { useGit } from "../../src/stores/gitStore";

describe("gitStore", () => {
  beforeEach(() => useGit.getState().clear());

  it("starts cleared", () => {
    const s = useGit.getState();
    expect(s.workspaceInfo).toBeNull();
    expect(s.statuses.size).toBe(0);
    expect(s.lastFetchedAt).toBeNull();
  });

  it("setWorkspaceInfo populates statuses Map", () => {
    useGit.getState().setWorkspaceInfo({
      branch: "main",
      ahead: 0,
      behind: 0,
      remoteUrl: null,
      statuses: { "src/x.ts": "Modified", "src/y.ts": "Untracked" },
    });
    const s = useGit.getState();
    expect(s.workspaceInfo?.branch).toBe("main");
    expect(s.statuses.get("src/x.ts")).toBe("Modified");
    expect(s.statuses.get("src/y.ts")).toBe("Untracked");
  });

  it("clear resets all state", () => {
    useGit.getState().setWorkspaceInfo({
      branch: "main",
      ahead: 0,
      behind: 0,
      remoteUrl: null,
      statuses: { x: "Modified" },
    });
    useGit.getState().clear();
    const s = useGit.getState();
    expect(s.workspaceInfo).toBeNull();
    expect(s.statuses.size).toBe(0);
  });
});
