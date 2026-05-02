import { describe, expect, it } from "vitest";
import { translateError, type AppErrorEnvelope } from "../../src/lib/error-translate";

describe("translateError", () => {
  it("maps NotFound with path", () => {
    const env: AppErrorEnvelope = {
      kind: "NotFound",
      message: "not found: C:\\foo",
      context: { path: "C:\\foo" },
    };
    expect(translateError(env)).toBe("Path not found: C:\\foo");
  });

  it("maps PermissionDenied with path", () => {
    expect(
      translateError({
        kind: "PermissionDenied",
        message: "denied",
        context: { path: "C:\\bar" },
      })
    ).toBe("Permission denied: C:\\bar");
  });

  it("maps AlreadyExists with path", () => {
    expect(
      translateError({
        kind: "AlreadyExists",
        message: "already exists",
        context: { path: "C:\\dup.txt" },
      })
    ).toBe("Already exists: C:\\dup.txt");
  });

  it("maps InvalidName preserving the message", () => {
    expect(
      translateError({
        kind: "InvalidName",
        message: "Reserved Windows name 'CON'",
        context: { name: "CON" },
      })
    ).toBe("Invalid name: Reserved Windows name 'CON'");
  });

  it("maps WatcherError generically", () => {
    expect(
      translateError({
        kind: "WatcherError",
        message: "create workspace watcher: foo",
        context: null,
      })
    ).toBe("File watcher error. The tree may be out of date.");
  });

  it("maps Cancelled to a quiet message", () => {
    expect(
      translateError({ kind: "Cancelled", message: "cancelled", context: null })
    ).toBe("Operation cancelled.");
  });

  it("falls back to message for unknown kind", () => {
    expect(
      translateError({
        kind: "WeirdKind" as never,
        message: "unexpected",
        context: null,
      })
    ).toBe("unexpected");
  });

  it("handles a non-envelope thrown value", () => {
    expect(translateError(new Error("boom"))).toBe("boom");
    expect(translateError("plain string")).toBe("plain string");
  });
});
