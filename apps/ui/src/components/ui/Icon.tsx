import type { JSX } from "react";
import {
  File, FileCode, FileText, FileImage,
  Folder, FolderOpen,
  Search, Settings, GitBranch, GitCommit,
  Save, FilePlus, FolderPlus, Trash2, Edit2,
  ChevronDown, ChevronRight, ChevronUp, ChevronLeft,
  Plus, X as XIcon, Bot, PanelLeft, PanelRight, AlertTriangle,
} from "lucide-react";

export const ICONS = {
  file: File,
  fileCode: FileCode,
  fileText: FileText,
  fileImage: FileImage,
  folder: Folder,
  folderOpen: FolderOpen,
  search: Search,
  settings: Settings,
  gitBranch: GitBranch,
  gitCommit: GitCommit,
  save: Save,
  filePlus: FilePlus,
  folderPlus: FolderPlus,
  trash: Trash2,
  edit: Edit2,
  chevronDown: ChevronDown,
  chevronRight: ChevronRight,
  chevronUp: ChevronUp,
  chevronLeft: ChevronLeft,
  plus: Plus,
  close: XIcon,
  bot: Bot,
  panelLeft: PanelLeft,
  panelRight: PanelRight,
  warning: AlertTriangle,
} as const;

export type IconName = keyof typeof ICONS;

export interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  "aria-label"?: string;
}

export function Icon({ name, size = 14, className, ...rest }: IconProps): JSX.Element {
  const Component = ICONS[name];
  return <Component size={size} className={className} aria-hidden={!rest["aria-label"]} {...rest} />;
}
