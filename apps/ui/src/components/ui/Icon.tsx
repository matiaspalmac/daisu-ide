import type { JSX } from "react";
import {
  File, FileCode, FileText, FileImage,
  Folder, FolderOpen,
  MagnifyingGlass, Gear, GitBranch, GitCommit,
  FloppyDisk, FilePlus, FolderPlus, Trash, PencilSimple,
  CaretDown, CaretRight, CaretUp, CaretLeft,
  Plus, X, Robot, Sidebar, SidebarSimple, Warning,
} from "@phosphor-icons/react";

export const ICONS = {
  file: File,
  fileCode: FileCode,
  fileText: FileText,
  fileImage: FileImage,
  folder: Folder,
  folderOpen: FolderOpen,
  search: MagnifyingGlass,
  settings: Gear,
  gitBranch: GitBranch,
  gitCommit: GitCommit,
  save: FloppyDisk,
  filePlus: FilePlus,
  folderPlus: FolderPlus,
  trash: Trash,
  edit: PencilSimple,
  chevronDown: CaretDown,
  chevronRight: CaretRight,
  chevronUp: CaretUp,
  chevronLeft: CaretLeft,
  plus: Plus,
  close: X,
  bot: Robot,
  panelLeft: Sidebar,
  panelRight: SidebarSimple,
  warning: Warning,
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
