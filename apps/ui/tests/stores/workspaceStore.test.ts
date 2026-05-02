import { describe, expect, it, beforeEach } from "vitest";
import { useWorkspace } from "../../src/stores/workspaceStore";

describe("workspaceStore", () => {
  beforeEach(() => useWorkspace.getState().reset());

  it("starts with no workspace", () => {
    const s = useWorkspace.getState();
    expect(s.rootPath).toBeNull();
    expect(s.recentWorkspaces).toEqual([]);
  });

  it("setRootPath stores path", () => {
    const s = useWorkspace.getState();
    s.setRootPath("C:\\Proyectos\\foo");
    expect(useWorkspace.getState().rootPath).toBe("C:\\Proyectos\\foo");
  });

  it("setRootPath records into recents and dedupes", () => {
    const s = useWorkspace.getState();
    s.setRootPath("C:\\Proyectos\\foo");
    s.setRootPath("C:\\Proyectos\\bar");
    s.setRootPath("C:\\Proyectos\\foo");
    const recents = useWorkspace.getState().recentWorkspaces;
    expect(recents).toHaveLength(2);
    expect(recents[0]!.path).toBe("C:\\Proyectos\\foo");
    expect(recents[1]!.path).toBe("C:\\Proyectos\\bar");
  });

  it("recents capped at 10", () => {
    const s = useWorkspace.getState();
    for (let i = 0; i < 15; i += 1) {
      s.setRootPath(`C:\\Proyectos\\ws${i}`);
    }
    expect(useWorkspace.getState().recentWorkspaces).toHaveLength(10);
  });

  it("close clears rootPath but keeps recents", () => {
    const s = useWorkspace.getState();
    s.setRootPath("C:\\foo");
    s.close();
    const next = useWorkspace.getState();
    expect(next.rootPath).toBeNull();
    expect(next.recentWorkspaces).toHaveLength(1);
  });
});
