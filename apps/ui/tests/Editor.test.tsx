import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Editor } from "../src/components/Editor";

vi.mock("@monaco-editor/react", () => ({
  default: ({ value, onChange, language }: { value: string; onChange?: (v: string | undefined) => void; language: string }) => (
    <textarea
      data-testid="monaco-mock"
      data-language={language}
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
    />
  ),
}));

describe("Editor", () => {
  it("renders monaco with the supplied value and language", () => {
    render(<Editor value="hello" language="typescript" onChange={() => undefined} />);
    const node = screen.getByTestId("monaco-mock");
    expect(node).toHaveValue("hello");
    expect(node).toHaveAttribute("data-language", "typescript");
  });
});
