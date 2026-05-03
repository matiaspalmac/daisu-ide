import type { JSX } from "react";
import {
  BookOpen,
  Braces,
  Cog,
  Eye,
  File,
  FileCode,
  FileCode2,
  FileText,
  FileType,
  Hash,
  Package,
  Palette,
  Settings,
  Settings2,
  Zap,
  type LucideIcon,
} from "lucide-react";

interface IconSpec {
  Icon: LucideIcon;
  color: string;
}

const EXT_MAP: Record<string, IconSpec> = {
  ts: { Icon: FileType, color: "#3178C6" },
  tsx: { Icon: FileCode, color: "#61DAFB" },
  js: { Icon: FileType, color: "#F7DF1E" },
  jsx: { Icon: FileCode, color: "#F7DF1E" },
  mjs: { Icon: FileType, color: "#F7DF1E" },
  cjs: { Icon: FileType, color: "#F7DF1E" },
  json: { Icon: Braces, color: "#FFCA28" },
  jsonc: { Icon: Braces, color: "#FFCA28" },
  md: { Icon: FileText, color: "#FF7043" },
  mdx: { Icon: FileText, color: "#FF7043" },
  html: { Icon: FileCode2, color: "#FF6E40" },
  htm: { Icon: FileCode2, color: "#FF6E40" },
  css: { Icon: Palette, color: "#42A5F5" },
  scss: { Icon: Palette, color: "#C6538C" },
  less: { Icon: Palette, color: "#1D365D" },
  rs: { Icon: Cog, color: "#DEA584" },
  toml: { Icon: Settings, color: "#9C9C9C" },
  yaml: { Icon: FileText, color: "#CB171E" },
  yml: { Icon: FileText, color: "#CB171E" },
  py: { Icon: FileType, color: "#3776AB" },
  go: { Icon: FileType, color: "#00ADD8" },
  java: { Icon: FileType, color: "#E76F00" },
  rb: { Icon: Hash, color: "#CC342D" },
  php: { Icon: FileType, color: "#777BB4" },
  sh: { Icon: Cog, color: "#89E051" },
  bash: { Icon: Cog, color: "#89E051" },
  sql: { Icon: FileText, color: "#E38C00" },
  xml: { Icon: FileCode2, color: "#E37933" },
  svg: { Icon: Palette, color: "#FFB13B" },
  txt: { Icon: FileText, color: "#9C9C9C" },
  log: { Icon: FileText, color: "#9C9C9C" },
  lock: { Icon: Eye, color: "#9C9C9C" },
};

const SPECIAL: Record<string, IconSpec> = {
  "package.json": { Icon: Package, color: "#FFCA28" },
  "package-lock.json": { Icon: Package, color: "#FFCA28" },
  "pnpm-lock.yaml": { Icon: Package, color: "#F69220" },
  "vite.config.ts": { Icon: Zap, color: "#A855F7" },
  "vite.config.js": { Icon: Zap, color: "#A855F7" },
  "tsconfig.json": { Icon: Settings2, color: "#3178C6" },
  "tsconfig.base.json": { Icon: Settings2, color: "#3178C6" },
  "tsconfig.app.json": { Icon: Settings2, color: "#3178C6" },
  "README.md": { Icon: BookOpen, color: "#FF7043" },
  "Cargo.toml": { Icon: Settings, color: "#DEA584" },
  "Cargo.lock": { Icon: Eye, color: "#DEA584" },
  ".gitignore": { Icon: Eye, color: "#F44336" },
  ".env": { Icon: Eye, color: "#FFCA28" },
};

const FALLBACK: IconSpec = { Icon: File, color: "#888" };

export function FileIcon({
  name,
  size = 14,
}: {
  name: string;
  size?: number;
}): JSX.Element {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const spec = SPECIAL[name] ?? EXT_MAP[ext] ?? FALLBACK;
  return <spec.Icon size={size} color={spec.color} strokeWidth={1.5} />;
}
