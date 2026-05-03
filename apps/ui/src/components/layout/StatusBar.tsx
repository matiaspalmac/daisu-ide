import type { JSX } from "react";
import { useWorkspace } from "../../stores/workspaceStore";
import { BranchSegment } from "../statusbar/BranchSegment";
import { SearchProgress } from "../statusbar/SearchProgress";
import { CursorSegment } from "../statusbar/CursorSegment";
import { EolSegment } from "../statusbar/EolSegment";
import { EncodingSegment } from "../statusbar/EncodingSegment";
import { IndentSegment } from "../statusbar/IndentSegment";
import { LanguagePicker } from "../statusbar/LanguagePicker";

export function StatusBar(): JSX.Element {
  const rootPath = useWorkspace((s) => s.rootPath);
  const workspaceName = rootPath ? rootPath.split(/[\\/]/).pop() : null;

  return (
    <footer className="daisu-statusbar" aria-label="Status bar">
      <div className="daisu-statusbar-left">
        {workspaceName && (
          <span className="daisu-status-segment">{workspaceName}</span>
        )}
        <BranchSegment />
      </div>
      <div className="daisu-statusbar-center">
        <SearchProgress />
      </div>
      <div className="daisu-statusbar-right">
        <CursorSegment />
        <EolSegment />
        <EncodingSegment />
        <IndentSegment />
        <LanguagePicker />
      </div>
    </footer>
  );
}
