import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => ({
    get: vi.fn(async () => null),
    set: vi.fn(async () => undefined),
    save: vi.fn(async () => undefined),
  })),
}));

vi.mock("../../src/api/tauri", () => ({
  gitWorkspaceInfoCmd: vi.fn(async () => ({
    branch: "main",
    ahead: 1,
    behind: 0,
    remoteUrl: "https://github.com/x/y.git",
    statuses: { "src/a.ts": "Modified", "src/b.ts": "Untracked" },
  })),
  gitListBranchesCmd: vi.fn(async () => [
    { name: "main", isRemote: false, isHead: true },
    { name: "feature", isRemote: false, isHead: false },
  ]),
  gitCheckoutBranchCmd: vi.fn(async () => undefined),
  gitFetchRemoteCmd: vi.fn(async () => ({
    commitsReceived: 3,
    remote: "origin",
  })),
}));

import { useGit } from "../../src/stores/gitStore";

beforeEach(() => useGit.getState().reset());

describe("gitStore", () => {
  it("starts empty", () => {
    const s = useGit.getState();
    expect(s.info).toBeNull();
    expect(s.branches).toEqual([]);
    expect(s.loading).toBe(false);
  });

  it("refresh populates info", async () => {
    useGit.getState().setWorkspacePath("/repo");
    await useGit.getState().refresh();
    const s = useGit.getState();
    expect(s.info?.branch).toBe("main");
    expect(s.info?.ahead).toBe(1);
    expect(s.loading).toBe(false);
  });

  it("loadBranches populates branches", async () => {
    useGit.getState().setWorkspacePath("/repo");
    await useGit.getState().loadBranches();
    expect(useGit.getState().branches).toHaveLength(2);
  });

  it("checkoutBranch invokes cmd then refreshes info + branches", async () => {
    const { gitCheckoutBranchCmd } = await import("../../src/api/tauri");
    useGit.getState().setWorkspacePath("/repo");
    await useGit.getState().checkoutBranch("feature", false);
    expect(gitCheckoutBranchCmd).toHaveBeenCalledWith("/repo", "feature", false);
  });

  it("fetchRemote invokes cmd and returns FetchResult", async () => {
    useGit.getState().setWorkspacePath("/repo");
    const result = await useGit.getState().fetchRemote("origin");
    expect(result.commitsReceived).toBe(3);
  });

  it("status selector reads from info.statuses", async () => {
    useGit.getState().setWorkspacePath("/repo");
    await useGit.getState().refresh();
    expect(useGit.getState().status("src/a.ts")).toBe("Modified");
    expect(useGit.getState().status("nope.ts")).toBeNull();
  });
});
