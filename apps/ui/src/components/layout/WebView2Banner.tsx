import type { JSX } from "react";
import { useEffect, useState } from "react";
import { detectWebView2 } from "../../api/tauri";

export function WebView2Banner(): JSX.Element | null {
  const [missing, setMissing] = useState<boolean>(false);

  useEffect(() => {
    detectWebView2()
      .then((status) => setMissing(!status.installed))
      .catch(() => setMissing(false));
  }, []);

  if (!missing) return null;

  return (
    <div className="daisu-banner" role="alert">
      WebView2 Runtime not detected. Download:{" "}
      <a
        href="https://developer.microsoft.com/en-us/microsoft-edge/webview2/"
        target="_blank"
        rel="noreferrer"
      >
        Microsoft Evergreen Bootstrapper
      </a>
    </div>
  );
}
