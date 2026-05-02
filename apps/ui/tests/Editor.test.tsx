import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Editor } from "../src/components/editor/Editor";

vi.mock("@monaco-editor/react", () => ({
  Editor: () => <div data-testid="monaco-stub" />,
  default: () => <div data-testid="monaco-stub" />,
}));
vi.mock("../src/api/tauri", () => ({
  openFile: vi.fn(),
  saveFile: vi.fn(),
  saveFileAsViaDialog: vi.fn(),
  saveSessionCmd: vi.fn(async () => undefined),
  loadSessionCmd: vi.fn(async () => null),
  deleteSessionCmd: vi.fn(async () => undefined),
}));
vi.mock("../src/lib/monaco-models", () => ({
  disposeModel: vi.fn(),
  disposeAllModels: vi.fn(),
  getOrCreateModel: vi.fn(),
}));

describe("<Editor>", () => {
  it("mounts the Monaco wrapper", () => {
    const { getByTestId } = render(<Editor />);
    expect(getByTestId("monaco-stub")).toBeInTheDocument();
  });
});
