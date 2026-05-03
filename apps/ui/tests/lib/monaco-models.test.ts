import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  disposeAllModels,
  disposeModel,
  getOrCreateModel,
  hasModel,
} from "../../src/lib/monaco-models";

interface FakeModel {
  uri: string;
  language: string;
  value: string;
  disposed: boolean;
  listeners: Array<() => void>;
  getValue(): string;
  setValue(v: string): void;
  dispose(): void;
  onDidChangeContent(cb: () => void): { dispose(): void };
}

const createdModels: FakeModel[] = [];

const fakeMonaco = {
  editor: {
    createModel: (value: string, language: string, uri: { toString(): string }) => {
      const m: FakeModel = {
        uri: uri.toString(),
        language,
        value,
        disposed: false,
        listeners: [],
        getValue: () => m.value,
        setValue: (v: string) => {
          m.value = v;
        },
        dispose: () => {
          m.disposed = true;
        },
        onDidChangeContent: (cb: () => void) => {
          m.listeners.push(cb);
          return { dispose: () => undefined };
        },
      };
      createdModels.push(m);
      return m;
    },
  },
  Uri: {
    parse: (s: string) => ({ toString: () => s }),
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

vi.mock("../../src/stores/tabsStore", () => ({
  useTabs: {
    getState: () => ({ updateContent: vi.fn() }),
  },
}));

const tab = (id: string) => ({
  id,
  path: null,
  name: "Untitled",
  language: "plaintext",
  content: "x",
  savedContent: "x",
  cursorState: null,
  pinned: false,
  untitledIndex: 1,
  eol: "LF" as const,
  encoding: "UTF-8",
});

beforeEach(() => {
  createdModels.length = 0;
  disposeAllModels();
});
afterEach(() => disposeAllModels());

describe("monaco-models registry", () => {
  it("createOrGet creates a model on first call", () => {
    const m = getOrCreateModel(fakeMonaco, tab("a"));
    expect(m).toBeDefined();
    expect(hasModel("a")).toBe(true);
  });

  it("createOrGet returns the same instance on second call", () => {
    const first = getOrCreateModel(fakeMonaco, tab("a"));
    const second = getOrCreateModel(fakeMonaco, tab("a"));
    expect(first).toBe(second);
  });

  it("disposeModel removes from registry and disposes Monaco model", () => {
    getOrCreateModel(fakeMonaco, tab("a"));
    disposeModel("a");
    expect(hasModel("a")).toBe(false);
    expect(createdModels[0]?.disposed).toBe(true);
  });

  it("disposeAllModels disposes all and clears", () => {
    getOrCreateModel(fakeMonaco, tab("a"));
    getOrCreateModel(fakeMonaco, tab("b"));
    expect(hasModel("a") && hasModel("b")).toBe(true);
    disposeAllModels();
    expect(hasModel("a") || hasModel("b")).toBe(false);
    expect(createdModels.every((m) => m.disposed)).toBe(true);
  });
});
