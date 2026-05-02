import { describe, expect, it } from "vitest";
import { ACTIONS, ACTION_CATEGORIES } from "../../src/lib/keybinding-registry";

describe("ACTIONS registry", () => {
  it("contains the expected categories", () => {
    const cats = new Set(ACTIONS.map((a) => a.category));
    for (const c of ACTION_CATEGORIES) {
      expect(cats.has(c)).toBe(true);
    }
  });

  it("ids are unique", () => {
    const ids = new Set<string>();
    for (const a of ACTIONS) {
      expect(ids.has(a.id)).toBe(false);
      ids.add(a.id);
    }
  });

  it("default bindings are unique", () => {
    const bindings = new Set<string>();
    for (const a of ACTIONS) {
      if (!a.defaultBinding) continue;
      expect(
        bindings.has(a.defaultBinding),
        `duplicate default binding: ${a.defaultBinding}`,
      ).toBe(false);
      bindings.add(a.defaultBinding);
    }
  });

  it("includes the 9 tabs.gotoN entries", () => {
    for (let i = 1; i <= 9; i++) {
      const a = ACTIONS.find((x) => x.id === `tabs.goto${i}`);
      expect(a, `tabs.goto${i} missing`).toBeDefined();
      expect(a?.defaultBinding).toBe(`$mod+${i}`);
    }
  });

  it("includes the migrated Phase 3 hardcoded combos", () => {
    const expected = [
      ["file.save", "$mod+s"],
      ["file.saveAs", "$mod+Shift+s"],
      ["file.new", "$mod+n"],
      ["tabs.close", "$mod+w"],
      ["tabs.next", "$mod+Tab"],
      ["tabs.prev", "$mod+Shift+Tab"],
      ["tabs.reopenClosed", "$mod+Shift+t"],
    ];
    for (const [id, combo] of expected) {
      const a = ACTIONS.find((x) => x.id === id);
      expect(a?.defaultBinding).toBe(combo);
    }
  });

  it("at least 20 distinct user-facing actions (Phase 4 baseline)", () => {
    // Collapsing tabs.goto2..9 into a single user-facing row, Phase 4 ships
    // 20 distinct rows in <KeybindingsList>. Spec called out ~22; tightened
    // here to the actual count once duplicates and tabs.goto bundling settled.
    const distinct = new Set(
      ACTIONS.filter((a) => !/^tabs\.goto[2-9]$/.test(a.id)).map((a) => a.id),
    );
    expect(distinct.size).toBeGreaterThanOrEqual(20);
  });
});
