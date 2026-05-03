import { memo, type JSX } from "react";
import {
  BookOpen,
  BracketsCurly,
  Gear,
  GearSix,
  FileLock,
  File,
  FileCode,
  FileCss,
  FileHtml,
  FileJs,
  FileJsx,
  FileMd,
  FilePy,
  FileRs,
  FileSql,
  FileText,
  FileTs,
  FileTsx,
  Hash,
  Package,
  Palette,
  RocketLaunch,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";

interface IconSpec {
  Icon: PhosphorIcon;
  color: string;
}

const EXT_MAP: Record<string, IconSpec> = {
  ts: { Icon: FileTs, color: "#3178C6" },
  tsx: { Icon: FileTsx, color: "#61DAFB" },
  js: { Icon: FileJs, color: "#F7DF1E" },
  jsx: { Icon: FileJsx, color: "#F7DF1E" },
  mjs: { Icon: FileJs, color: "#F7DF1E" },
  cjs: { Icon: FileJs, color: "#F7DF1E" },
  json: { Icon: BracketsCurly, color: "#FFCA28" },
  jsonc: { Icon: BracketsCurly, color: "#FFCA28" },
  md: { Icon: FileMd, color: "#FF7043" },
  mdx: { Icon: FileMd, color: "#FF7043" },
  html: { Icon: FileHtml, color: "#FF6E40" },
  htm: { Icon: FileHtml, color: "#FF6E40" },
  css: { Icon: FileCss, color: "#42A5F5" },
  scss: { Icon: FileCss, color: "#C6538C" },
  less: { Icon: FileCss, color: "#1D365D" },
  rs: { Icon: FileRs, color: "#DEA584" },
  toml: { Icon: Gear, color: "#9C9C9C" },
  yaml: { Icon: FileCode, color: "#CB171E" },
  yml: { Icon: FileCode, color: "#CB171E" },
  py: { Icon: FilePy, color: "#3776AB" },
  go: { Icon: FileCode, color: "#00ADD8" },
  java: { Icon: FileCode, color: "#E76F00" },
  rb: { Icon: Hash, color: "#CC342D" },
  php: { Icon: FileCode, color: "#777BB4" },
  sh: { Icon: Gear, color: "#89E051" },
  bash: { Icon: Gear, color: "#89E051" },
  sql: { Icon: FileSql, color: "#E38C00" },
  xml: { Icon: FileCode, color: "#E37933" },
  svg: { Icon: Palette, color: "#FFB13B" },
  txt: { Icon: FileText, color: "#9C9C9C" },
  log: { Icon: FileText, color: "#9C9C9C" },
  lock: { Icon: FileLock, color: "#9C9C9C" },
};

const SPECIAL: Record<string, IconSpec> = {
  "package.json": { Icon: Package, color: "#FFCA28" },
  "package-lock.json": { Icon: Package, color: "#FFCA28" },
  "pnpm-lock.yaml": { Icon: Package, color: "#F69220" },
  "vite.config.ts": { Icon: RocketLaunch, color: "#A855F7" },
  "vite.config.js": { Icon: RocketLaunch, color: "#A855F7" },
  "tsconfig.json": { Icon: GearSix, color: "#3178C6" },
  "tsconfig.base.json": { Icon: GearSix, color: "#3178C6" },
  "tsconfig.app.json": { Icon: GearSix, color: "#3178C6" },
  "README.md": { Icon: BookOpen, color: "#FF7043" },
  "Cargo.toml": { Icon: Gear, color: "#DEA584" },
  "Cargo.lock": { Icon: FileLock, color: "#DEA584" },
  ".gitignore": { Icon: FileLock, color: "#F44336" },
  ".env": { Icon: FileLock, color: "#FFCA28" },
};

const FALLBACK: IconSpec = { Icon: File, color: "#888" };

function FileIconImpl({
  name,
  size = 14,
}: {
  name: string;
  size?: number;
}): JSX.Element {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const spec = SPECIAL[name] ?? EXT_MAP[ext] ?? FALLBACK;
  return <spec.Icon size={size} color={spec.color} />;
}

export const FileIcon = memo(FileIconImpl);
