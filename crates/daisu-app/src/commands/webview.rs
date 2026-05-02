use serde::Serialize;

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct WebView2Status {
    pub installed: bool,
    pub version: Option<String>,
}

#[cfg(target_os = "windows")]
#[must_use]
pub fn detect_webview2_impl() -> WebView2Status {
    use windows_registry::{CURRENT_USER, LOCAL_MACHINE};

    const KEYS: &[&str] = &[
        r"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
        r"SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
    ];

    for key in KEYS {
        if let Ok(handle) = LOCAL_MACHINE.open(key).or_else(|_| CURRENT_USER.open(key)) {
            if let Ok(version) = handle.get_string("pv") {
                if !version.is_empty() && version != "0.0.0.0" {
                    return WebView2Status {
                        installed: true,
                        version: Some(version),
                    };
                }
            }
        }
    }

    WebView2Status {
        installed: false,
        version: None,
    }
}

#[cfg(not(target_os = "windows"))]
#[must_use]
pub fn detect_webview2_impl() -> WebView2Status {
    WebView2Status {
        installed: false,
        version: None,
    }
}

/// Detect `WebView2` runtime presence by looking up its registry key.
///
/// Returns `installed = false` and `version = None` on non-Windows platforms.
#[tauri::command]
#[must_use]
pub fn detect_webview2() -> WebView2Status {
    detect_webview2_impl()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_serializes_to_expected_shape() {
        let status = WebView2Status {
            installed: true,
            version: Some("131.0.2903.86".to_string()),
        };
        let json = serde_json::to_string(&status).unwrap();
        assert!(json.contains("\"installed\":true"));
        assert!(json.contains("\"version\":\"131.0.2903.86\""));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn detect_webview2_runs_on_dev_machine() {
        let status = detect_webview2_impl();
        assert!(
            status.installed,
            "WebView2 must be installed on the dev machine"
        );
        assert!(!status.version.as_deref().unwrap_or("").is_empty());
    }
}
