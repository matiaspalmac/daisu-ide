import { type JSX, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { File, Folder, FolderOpen, FileCode } from "@phosphor-icons/react";

interface Props {
  name: string;
  output: unknown;
  ok: boolean;
}

/**
 * Per-tool result renderer. Falls back to a styled JSON dump when the
 * tool is unknown to the renderer or the output shape doesn't match.
 */
export function ToolResultRenderer({ name, output, ok }: Props): JSX.Element {
  if (!ok) {
    return <ErroredResult output={output} />;
  }
  switch (name) {
    case "read_file":
      return <ReadFileResult output={output} />;
    case "list_dir":
      return <ListDirResult output={output} />;
    case "write_file":
      return <WriteFileResult output={output} />;
    default:
      return <RawJsonResult output={output} />;
  }
}

interface ReadFileOutput {
  path?: string;
  bytes?: number;
  total_lines?: number;
  shown_lines?: [number, number];
  truncated?: boolean;
  contents?: string;
  hint?: string;
}

function ReadFileResult({ output }: { output: unknown }): JSX.Element {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const o = (output ?? {}) as ReadFileOutput;
  const path = o.path ?? "(unknown)";
  const basename = path.split(/[\\/]/).pop() ?? path;
  const bytes = o.bytes ?? 0;
  const totalLines = o.total_lines ?? 0;
  const shown = o.shown_lines ?? [0, totalLines];
  const truncated = !!o.truncated;
  const contents = o.contents ?? "";

  const lineCount = useMemo(() => contents.split("\n").length - 1, [contents]);
  const collapsed = !expanded && lineCount > 20;
  const visibleContents = collapsed
    ? contents.split("\n").slice(0, 20).join("\n")
    : contents;

  return (
    <div className="daisu-tool-result is-read-file">
      <div className="daisu-tool-result-head">
        <FileCode size={12} className="text-[var(--accent)]" />
        <span className="daisu-tool-result-path" title={path}>
          {basename}
        </span>
        <span className="daisu-tool-result-meta">
          {t("chat.readFileMeta", {
            defaultValue: "{{lines}} lines · {{bytes}}",
            lines: totalLines,
            bytes: formatBytes(bytes),
          })}
        </span>
        {truncated && (
          <span className="daisu-tool-result-pill is-warn">
            {t("chat.truncated", { defaultValue: "truncated" })}
          </span>
        )}
      </div>
      <pre className="daisu-tool-result-code">
        <code>{visibleContents}</code>
      </pre>
      {(collapsed || (!collapsed && lineCount > 20)) && (
        <button
          type="button"
          className="daisu-btn-ghost daisu-tool-result-toggle"
          onClick={() => setExpanded((v) => !v)}
        >
          {collapsed
            ? t("chat.showAll", {
                defaultValue: "Show all {{count}} lines",
                count: lineCount,
              })
            : t("chat.collapse", { defaultValue: "Collapse" })}
        </button>
      )}
      <p className="daisu-tool-result-rangelabel">
        {t("chat.readFileShowing", {
          defaultValue: "Showing lines {{start}}-{{end}} of {{total}}",
          start: shown[0],
          end: shown[1],
          total: totalLines,
        })}
      </p>
    </div>
  );
}

interface ListDirEntry {
  name: string;
  kind: "dir" | "file" | "other";
}
interface ListDirOutput {
  path?: string;
  entries?: ListDirEntry[];
  total?: number;
  truncated?: boolean;
  hint?: string;
}

function ListDirResult({ output }: { output: unknown }): JSX.Element {
  const { t } = useTranslation();
  const o = (output ?? {}) as ListDirOutput;
  const entries = o.entries ?? [];
  const total = o.total ?? entries.length;
  const truncated = !!o.truncated;
  const path = o.path ?? "";
  const basename = path.split(/[\\/]/).filter(Boolean).pop() ?? "/";
  const dirCount = entries.filter((e) => e.kind === "dir").length;
  const fileCount = entries.filter((e) => e.kind === "file").length;

  return (
    <div className="daisu-tool-result is-list-dir">
      <div className="daisu-tool-result-head">
        <FolderOpen size={12} className="text-[var(--accent)]" />
        <span className="daisu-tool-result-path" title={path}>
          {basename}
        </span>
        <span className="daisu-tool-result-meta">
          {t("chat.listDirMeta", {
            defaultValue: "{{dirs}} dirs · {{files}} files · {{total}} total",
            dirs: dirCount,
            files: fileCount,
            total,
          })}
        </span>
        {truncated && (
          <span className="daisu-tool-result-pill is-warn">
            {t("chat.truncated", { defaultValue: "truncated" })}
          </span>
        )}
      </div>
      <ul className="daisu-tool-result-tree" role="list">
        {entries.map((e) => (
          <li
            key={`${e.kind}-${e.name}`}
            className={`daisu-tool-result-entry is-${e.kind}`}
          >
            {e.kind === "dir" ? (
              <Folder size={11} weight="fill" />
            ) : (
              <File size={11} />
            )}
            <span>{e.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface WriteFileOutput {
  path?: string;
  bytes?: number;
}
function WriteFileResult({ output }: { output: unknown }): JSX.Element {
  const { t } = useTranslation();
  const o = (output ?? {}) as WriteFileOutput;
  const path = o.path ?? "(unknown)";
  const basename = path.split(/[\\/]/).pop() ?? path;
  return (
    <div className="daisu-tool-result is-write-file">
      <div className="daisu-tool-result-head">
        <FileCode size={12} className="text-[var(--success)]" />
        <span className="daisu-tool-result-path" title={path}>
          {basename}
        </span>
        <span className="daisu-tool-result-meta">
          {t("chat.writeFileMeta", {
            defaultValue: "{{bytes}} written",
            bytes: formatBytes(o.bytes ?? 0),
          })}
        </span>
      </div>
    </div>
  );
}

function ErroredResult({ output }: { output: unknown }): JSX.Element {
  const { t } = useTranslation();
  const text = useMemo(() => formatErrorOutput(output), [output]);
  return (
    <div className="daisu-tool-result is-error" role="alert">
      <span className="daisu-tool-result-head-error">
        {t("chat.toolErrored", { defaultValue: "Tool failed" })}
      </span>
      <pre className="daisu-tool-result-code">
        <code>{text}</code>
      </pre>
    </div>
  );
}

function RawJsonResult({ output }: { output: unknown }): JSX.Element {
  const text = useMemo(() => prettyJson(output), [output]);
  return (
    <pre className="daisu-tool-result-code is-raw">
      <code>{text}</code>
    </pre>
  );
}

function prettyJson(v: unknown): string {
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function formatErrorOutput(v: unknown): string {
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.error === "string") return o.error;
    if (typeof o.denied === "string") return `Denied: ${o.denied}`;
  }
  return prettyJson(v);
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
}
