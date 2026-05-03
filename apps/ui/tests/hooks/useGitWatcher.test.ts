import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listeners: Record<string, (() => void) | null> = {
  "git-changed": null,
  "tauri://focus": null,
};

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (event: string, cb: () => void) => {
    listeners[event] = cb;
    return () => {
      listeners[event] = null;
    };
  }),
}));

vi.mock("../../src/lib/tauri-env", () => ({
  isTauri: () => true,
}));

const refresh = vi.fn(async () => undefined);
vi.mock("../../src/stores/gitStore", () => ({
  useGit: { getState: () => ({ refresh }) },
}));

import { useGitWatcher } from "../../src/hooks/useGitWatcher";

beforeEach(() => {
  refresh.mockClear();
  listeners["git-changed"] = null;
  listeners["tauri://focus"] = null;
});

afterEach(() => undefined);

describe("useGitWatcher", () => {
  it("registers git-changed and focus listeners on mount", async () => {
    renderHook(() => useGitWatcher());
    await Promise.resolve();
    await Promise.resolve();
    expect(listeners["git-changed"]).toBeTruthy();
    expect(listeners["tauri://focus"]).toBeTruthy();
  });

  it("git-changed fires gitStore.refresh", async () => {
    vi.useFakeTimers();
    renderHook(() => useGitWatcher());
    await Promise.resolve();
    await Promise.resolve();
    listeners["git-changed"]?.();
    // Hook debounces by 250ms before invoking refresh.
    vi.advanceTimersByTime(260);
    expect(refresh).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("focus fires gitStore.refresh", async () => {
    vi.useFakeTimers();
    renderHook(() => useGitWatcher());
    await Promise.resolve();
    await Promise.resolve();
    listeners["tauri://focus"]?.();
    vi.advanceTimersByTime(260);
    expect(refresh).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("unmount unsubscribes both listeners", async () => {
    const { unmount } = renderHook(() => useGitWatcher());
    await Promise.resolve();
    await Promise.resolve();
    unmount();
    expect(listeners["git-changed"]).toBeNull();
    expect(listeners["tauri://focus"]).toBeNull();
  });
});
