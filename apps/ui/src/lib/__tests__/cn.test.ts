import { describe, expect, it } from "vitest";
import { cn } from "@/lib/cn";

describe("cn()", () => {
  it("joins class strings", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("filters falsy values", () => {
    expect(cn("a", false, null, undefined, "", "b")).toBe("a b");
  });

  it("merges conflicting tailwind utilities (last wins)", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
    expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
  });

  it("merges conditional classes from object syntax", () => {
    expect(cn("base", { active: true, disabled: false })).toBe("base active");
  });
});
