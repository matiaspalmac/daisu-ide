import type { JSX } from "react";
import { useEffect, useState } from "react";
import { detectWebView2 } from "../../api/tauri";

export function TitleBar(): JSX.Element {
  const [webview2Missing, setWebview2Missing] = useState<boolean>(false);

  useEffect(() => {
    detectWebView2()
      .then((status) => setWebview2Missing(!status.installed))
      .catch(() => setWebview2Missing(false));
  }, []);

  if (!webview2Missing) return <></>;

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
