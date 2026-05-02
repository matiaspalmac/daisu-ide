import { beforeEach, describe, expect, it, vi } from "vitest";
import { useThemes } from "../../src/stores/themesStore";

vi.mock("../../src/api/tauri", () => ({
  listBundledThemesCmd: vi.fn(async () => [
    { id: "daisu-dark", name: "Daisu Dark", kind: "dark" },
    { id: "daisu-light", name: "Daisu Light", kind: "light" },
  ]),
}));

beforeEach(() => useThemes.getState().reset());

describe("themesStore", () => {
  it("starts with empty bundled list and not loaded", () => {
    const s = useThemes.getState();
    expect(s.bundled).toEqual([]);
    expect(s.loaded).toBe(false);
  });

  it("loadBundled populates the list", async () => {
    await useThemes.getState().loadBundled();
    const s = useThemes.getState();
    expect(s.loaded).toBe(true);
    expect(s.bundled).toHaveLength(2);
    expect(s.bundled.map((t) => t.id)).toEqual(["daisu-dark", "daisu-light"]);
  });

  it("loadBundled is idempotent", async () => {
    const { listBundledThemesCmd } = await import("../../src/api/tauri");
    (listBundledThemesCmd as ReturnType<typeof vi.fn>).mockClear();
    const tabs = useThemes.getState();
    await tabs.loadBundled();
    await tabs.loadBundled();
    expect(useThemes.getState().bundled).toHaveLength(2);
    expect((listBundledThemesCmd as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  it("filtersByKind returns only matching", async () => {
    await useThemes.getState().loadBundled();
    expect(useThemes.getState().filterByKind("dark")).toEqual([
      { id: "daisu-dark", name: "Daisu Dark", kind: "dark" },
    ]);
    expect(useThemes.getState().filterByKind("light")).toEqual([
      { id: "daisu-light", name: "Daisu Light", kind: "light" },
    ]);
  });
});
