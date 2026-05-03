import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { highlightMatch } from "../../src/lib/search-highlight";

describe("highlightMatch", () => {
  it("wraps the matched range in a mark element", () => {
    const { container } = render(<>{highlightMatch("hello world", 0, 5)}</>);
    const mark = container.querySelector("mark");
    expect(mark?.textContent).toBe("hello");
  });

  it("renders prefix and suffix as plain text", () => {
    const { container } = render(<>{highlightMatch("foo bar baz", 4, 7)}</>);
    expect(container.textContent).toBe("foo bar baz");
    const mark = container.querySelector("mark");
    expect(mark?.textContent).toBe("bar");
  });

  it("clamps start past line length to line length", () => {
    const { container } = render(<>{highlightMatch("ab", 10, 20)}</>);
    expect(container.querySelector("mark")?.textContent).toBe("");
    expect(container.textContent).toBe("ab");
  });

  it("clamps negative start to zero", () => {
    const { container } = render(<>{highlightMatch("ab", -5, 1)}</>);
    expect(container.querySelector("mark")?.textContent).toBe("a");
  });

  it("renders empty mark when start equals end", () => {
    const { container } = render(<>{highlightMatch("ab", 1, 1)}</>);
    expect(container.querySelector("mark")?.textContent).toBe("");
  });
});
