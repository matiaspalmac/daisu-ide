// Stub for monaco-editor used during vitest runs.
// Real Monaco only loads in the browser; tests mock the surfaces they need
// via vi.mock("monaco-editor", ...). This stub exists so Vite's resolver
// has something to load when vi.mock has not been applied at the import site.

export const editor = {
  createModel: () => ({
    dispose: () => undefined,
    getValue: () => "",
    setValue: () => undefined,
    onDidChangeContent: () => ({ dispose: () => undefined }),
  }),
};

export const Uri = {
  parse: (s: string) => ({ toString: () => s }),
};
