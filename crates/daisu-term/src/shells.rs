//! Shell detection — enumerate shells available on the host so the user
//! can pick one in the terminal picker. Detection is registry-first on
//! Windows (cheap, never blocks), filesystem on Mac/Linux. Results are
//! cached in a `OnceCell` so the picker doesn't re-stat 30+ paths on
//! every open.

use std::path::Path;
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DetectedShell {
    pub id: String,
    pub label: String,
    pub path: String,
    pub args: Vec<String>,
    pub icon: String,
    pub is_default: bool,
}

static CACHE: OnceLock<Vec<DetectedShell>> = OnceLock::new();

#[must_use]
pub fn detect_shells() -> Vec<DetectedShell> {
    CACHE.get_or_init(detect_shells_uncached).clone()
}

#[must_use]
pub fn detect_shells_uncached() -> Vec<DetectedShell> {
    let shells = if cfg!(windows) {
        detect_windows()
    } else if cfg!(target_os = "macos") {
        detect_unix(true)
    } else {
        detect_unix(false)
    };
    dedupe(shells)
}

#[must_use]
pub fn shell_by_id(id: &str) -> Option<DetectedShell> {
    detect_shells().into_iter().find(|s| s.id == id)
}

fn dedupe(mut shells: Vec<DetectedShell>) -> Vec<DetectedShell> {
    let mut seen = std::collections::HashSet::new();
    shells.retain(|s| {
        let key = canonical_key(&s.path);
        seen.insert(key)
    });
    shells
}

fn canonical_key(path: &str) -> String {
    Path::new(path)
        .canonicalize()
        .map_or_else(|_| path.to_lowercase(), |p| p.to_string_lossy().to_string())
}

#[cfg(windows)]
fn detect_windows() -> Vec<DetectedShell> {
    let mut out = Vec::new();
    out.extend(detect_pwsh_windows());
    out.extend(detect_windows_powershell_5());
    out.extend(detect_cmd());
    out.extend(detect_git_bash());
    out.extend(detect_msys2_cygwin());
    out.extend(detect_wsl_distros());
    out.extend(detect_nushell_windows());
    let default_id = host_default_shell_id_windows();
    flag_default(&mut out, &default_id);
    out
}

#[cfg(not(windows))]
fn detect_windows() -> Vec<DetectedShell> {
    Vec::new()
}

#[cfg(windows)]
fn host_default_shell_id_windows() -> String {
    // Windows has no canonical "user login shell". Prefer pwsh > windows
    // powershell > cmd in that order — matches VSCode's pick.
    "pwsh".into()
}

#[cfg(windows)]
fn detect_pwsh_windows() -> Vec<DetectedShell> {
    let mut out = Vec::new();
    let candidates = pwsh_candidate_paths();
    for (label, path) in candidates {
        if Path::new(&path).is_file() {
            out.push(DetectedShell {
                id: "pwsh".into(),
                label,
                path,
                args: vec![],
                icon: "terminalPowerShell".into(),
                is_default: false,
            });
            break;
        }
    }
    out
}

#[cfg(windows)]
fn pwsh_candidate_paths() -> Vec<(String, String)> {
    let mut out = Vec::new();
    if let Ok(pf) = std::env::var("ProgramFiles") {
        if let Ok(entries) = std::fs::read_dir(format!("{pf}\\PowerShell")) {
            for entry in entries.flatten() {
                let path = entry.path().join("pwsh.exe");
                if path.is_file() {
                    let v = entry.file_name().to_string_lossy().to_string();
                    out.push((format!("PowerShell {v}"), path.display().to_string()));
                }
            }
        }
    }
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        let msix = format!(
            "{local}\\Microsoft\\WindowsApps\\Microsoft.PowerShell_8wekyb3d8bbwe\\pwsh.exe"
        );
        if Path::new(&msix).is_file() {
            out.push(("PowerShell (Store)".into(), msix));
        }
    }
    out
}

#[cfg(windows)]
fn detect_windows_powershell_5() -> Vec<DetectedShell> {
    let path = std::env::var("SystemRoot").map_or_else(
        |_| "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe".into(),
        |sr| format!("{sr}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"),
    );
    if Path::new(&path).is_file() {
        vec![DetectedShell {
            id: "powershell".into(),
            label: "Windows PowerShell".into(),
            path,
            args: vec![],
            icon: "terminalPowerShell".into(),
            is_default: false,
        }]
    } else {
        vec![]
    }
}

#[cfg(windows)]
fn detect_cmd() -> Vec<DetectedShell> {
    // Pin to System32 explicitly — never trust PATH for cmd.exe.
    let path = std::env::var("SystemRoot").map_or_else(
        |_| "C:\\Windows\\System32\\cmd.exe".into(),
        |sr| format!("{sr}\\System32\\cmd.exe"),
    );
    if Path::new(&path).is_file() {
        vec![DetectedShell {
            id: "cmd".into(),
            label: "Command Prompt".into(),
            path,
            args: vec![],
            icon: "terminal".into(),
            is_default: false,
        }]
    } else {
        vec![]
    }
}

#[cfg(windows)]
fn detect_git_bash() -> Vec<DetectedShell> {
    let candidates = [
        std::env::var("ProgramW6432")
            .map(|p| format!("{p}\\Git\\bin\\bash.exe"))
            .ok(),
        std::env::var("ProgramFiles")
            .map(|p| format!("{p}\\Git\\bin\\bash.exe"))
            .ok(),
        std::env::var("ProgramFiles(x86)")
            .map(|p| format!("{p}\\Git\\bin\\bash.exe"))
            .ok(),
        std::env::var("LOCALAPPDATA")
            .map(|l| format!("{l}\\Programs\\Git\\bin\\bash.exe"))
            .ok(),
    ];
    for path in candidates.into_iter().flatten() {
        if Path::new(&path).is_file() {
            return vec![DetectedShell {
                id: "git-bash".into(),
                label: "Git Bash".into(),
                path,
                args: vec!["--login".into(), "-i".into()],
                icon: "terminalBash".into(),
                is_default: false,
            }];
        }
    }
    vec![]
}

#[cfg(windows)]
fn detect_msys2_cygwin() -> Vec<DetectedShell> {
    let mut out = Vec::new();
    let drive = std::env::var("HOMEDRIVE").unwrap_or_else(|_| "C:".into());
    for (id, label, root) in [
        (
            "msys2",
            "MSYS2",
            format!("{drive}\\msys64\\usr\\bin\\bash.exe"),
        ),
        (
            "cygwin",
            "Cygwin",
            format!("{drive}\\cygwin64\\bin\\bash.exe"),
        ),
    ] {
        if Path::new(&root).is_file() {
            out.push(DetectedShell {
                id: id.into(),
                label: label.into(),
                path: root,
                args: vec!["--login".into(), "-i".into()],
                icon: "terminalBash".into(),
                is_default: false,
            });
        }
    }
    out
}

#[cfg(windows)]
fn detect_wsl_distros() -> Vec<DetectedShell> {
    let mut out = Vec::new();
    if let Ok(distros) = wsl_distros_via_registry() {
        out.extend(distros);
        return out;
    }
    // Fallback: parse `wsl.exe -l -v` UTF-16LE
    if let Ok(distros) = wsl_distros_via_command() {
        out.extend(distros);
    }
    out
}

#[cfg(windows)]
fn wsl_distros_via_registry() -> Result<Vec<DetectedShell>, String> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let lxss = hkcu
        .open_subkey("SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Lxss")
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    let wsl_path = wsl_exe_path();
    for guid in lxss.enum_keys().flatten() {
        let distro = lxss.open_subkey(&guid).map_err(|e| e.to_string())?;
        let name: String = distro.get_value("DistributionName").unwrap_or_default();
        if name.is_empty()
            || name.starts_with("docker-desktop")
            || name.starts_with("rancher-desktop")
        {
            continue;
        }
        out.push(DetectedShell {
            id: format!("wsl-{name}"),
            label: format!("{name} (WSL)"),
            path: wsl_path.clone(),
            args: vec!["-d".into(), name.clone()],
            icon: "tux".into(),
            is_default: false,
        });
    }
    Ok(out)
}

#[cfg(windows)]
fn wsl_distros_via_command() -> Result<Vec<DetectedShell>, String> {
    let out = std::process::Command::new(wsl_exe_path())
        .args(["-l", "-v"])
        .output()
        .map_err(|e| e.to_string())?;
    let (text, _, _) = encoding_rs::UTF_16LE.decode(&out.stdout);
    let wsl_path = wsl_exe_path();
    let mut shells = Vec::new();
    for line in text.lines().skip(1) {
        let trimmed = line.trim_start();
        let row = trimmed.trim_start_matches('*').trim();
        let name = row.split_whitespace().next().unwrap_or("");
        if name.is_empty()
            || name.starts_with("docker-desktop")
            || name.starts_with("rancher-desktop")
        {
            continue;
        }
        shells.push(DetectedShell {
            id: format!("wsl-{name}"),
            label: format!("{name} (WSL)"),
            path: wsl_path.clone(),
            args: vec!["-d".into(), name.into()],
            icon: "tux".into(),
            is_default: false,
        });
    }
    Ok(shells)
}

#[cfg(windows)]
fn wsl_exe_path() -> String {
    std::env::var("SystemRoot").map_or_else(
        |_| "C:\\Windows\\System32\\wsl.exe".into(),
        |sr| format!("{sr}\\System32\\wsl.exe"),
    )
}

#[cfg(windows)]
fn detect_nushell_windows() -> Vec<DetectedShell> {
    let mut out = Vec::new();
    if let Ok(p) = which::which("nu") {
        if p.is_file() {
            out.push(DetectedShell {
                id: "nu".into(),
                label: "Nushell".into(),
                path: p.display().to_string(),
                args: vec![],
                icon: "terminal".into(),
                is_default: false,
            });
        }
    }
    out
}

#[cfg(not(windows))]
fn detect_unix(_is_mac: bool) -> Vec<DetectedShell> {
    let mut out = Vec::new();
    let user_default = host_default_shell_unix();
    out.extend(detect_etc_shells());
    out.extend(detect_homebrew_shells(_is_mac));
    out.extend(detect_pwsh_unix());
    flag_default(&mut out, &user_default);
    out
}

#[cfg(windows)]
fn detect_unix(_is_mac: bool) -> Vec<DetectedShell> {
    Vec::new()
}

#[cfg(not(windows))]
fn host_default_shell_unix() -> String {
    if let Ok(s) = std::env::var("SHELL") {
        if !s.is_empty() {
            return canonical_shell_id(&s);
        }
    }
    "bash".into()
}

#[cfg(not(windows))]
fn canonical_shell_id(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "bash".into())
}

#[cfg(not(windows))]
fn detect_etc_shells() -> Vec<DetectedShell> {
    let mut out = Vec::new();
    let content = std::fs::read_to_string("/etc/shells").unwrap_or_default();
    for line in content.lines() {
        let path = line.trim();
        if path.is_empty() || path.starts_with('#') {
            continue;
        }
        if !Path::new(path).is_file() {
            continue;
        }
        let id = canonical_shell_id(path);
        let label = match id.as_str() {
            "bash" => "Bash",
            "zsh" => "Zsh",
            "fish" => "Fish",
            "sh" => "POSIX sh",
            "dash" => "Dash",
            "nu" | "nushell" => "Nushell",
            other => other,
        }
        .to_string();
        out.push(DetectedShell {
            id: id.clone(),
            label,
            path: path.to_string(),
            args: vec![],
            icon: shell_icon(&id),
            is_default: false,
        });
    }
    out
}

#[cfg(not(windows))]
fn detect_homebrew_shells(is_mac: bool) -> Vec<DetectedShell> {
    if !is_mac {
        return Vec::new();
    }
    let prefixes = ["/opt/homebrew/bin", "/usr/local/bin"];
    let names = ["bash", "zsh", "fish", "nu", "pwsh"];
    let mut out = Vec::new();
    for prefix in prefixes {
        for name in names {
            let path = format!("{prefix}/{name}");
            if Path::new(&path).is_file() {
                out.push(DetectedShell {
                    id: name.into(),
                    label: format!("{} (Homebrew)", capitalize(name)),
                    path,
                    args: vec![],
                    icon: shell_icon(name),
                    is_default: false,
                });
            }
        }
    }
    out
}

#[cfg(not(windows))]
fn detect_pwsh_unix() -> Vec<DetectedShell> {
    if let Ok(p) = which::which("pwsh") {
        return vec![DetectedShell {
            id: "pwsh".into(),
            label: "PowerShell".into(),
            path: p.display().to_string(),
            args: vec![],
            icon: "terminalPowerShell".into(),
            is_default: false,
        }];
    }
    Vec::new()
}

#[cfg(not(windows))]
fn shell_icon(id: &str) -> String {
    match id {
        "bash" => "terminalBash",
        "zsh" => "terminalBash",
        "fish" => "fish",
        "pwsh" => "terminalPowerShell",
        "nu" | "nushell" => "terminal",
        _ => "terminal",
    }
    .into()
}

#[cfg(windows)]
#[allow(dead_code)]
fn shell_icon(_id: &str) -> String {
    "terminal".into()
}

#[cfg(not(windows))]
fn capitalize(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        Some(c) => c.to_uppercase().collect::<String>() + chars.as_str(),
        None => String::new(),
    }
}

fn flag_default(shells: &mut [DetectedShell], default_id: &str) {
    for s in shells.iter_mut() {
        if s.id == default_id {
            s.is_default = true;
            return;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_shells_returns_at_least_one() {
        let shells = detect_shells_uncached();
        // Every supported platform should detect at least one shell
        // (cmd.exe on Windows; /bin/sh or similar on Unix).
        assert!(
            !shells.is_empty(),
            "expected ≥1 detected shell on this host"
        );
    }

    #[test]
    fn shell_by_id_returns_none_for_unknown() {
        assert!(shell_by_id("xxx-not-a-shell").is_none());
    }

    #[test]
    fn detected_shells_have_existing_paths() {
        for s in detect_shells_uncached() {
            assert!(
                Path::new(&s.path).exists(),
                "shell {} path {} should exist",
                s.id,
                s.path
            );
        }
    }

    #[test]
    fn dedupe_strips_duplicate_paths() {
        let s = DetectedShell {
            id: "bash".into(),
            label: "Bash".into(),
            path: std::env::temp_dir().display().to_string(),
            args: vec![],
            icon: "terminalBash".into(),
            is_default: false,
        };
        let result = dedupe(vec![s.clone(), s.clone()]);
        assert_eq!(result.len(), 1);
    }

    #[test]
    fn flag_default_marks_matching_id() {
        let mut shells = vec![
            DetectedShell {
                id: "pwsh".into(),
                label: "PowerShell 7".into(),
                path: "/x".into(),
                args: vec![],
                icon: "terminalPowerShell".into(),
                is_default: false,
            },
            DetectedShell {
                id: "cmd".into(),
                label: "cmd".into(),
                path: "/y".into(),
                args: vec![],
                icon: "terminal".into(),
                is_default: false,
            },
        ];
        flag_default(&mut shells, "pwsh");
        assert!(shells[0].is_default);
        assert!(!shells[1].is_default);
    }

    #[cfg(not(windows))]
    #[test]
    fn unix_default_falls_back_to_bash_when_shell_unset() {
        // SAFETY: test mutates env; serial-test would be nicer but
        // we don't pull that crate just for one assertion.
        let prev = std::env::var("SHELL").ok();
        std::env::remove_var("SHELL");
        assert_eq!(host_default_shell_unix(), "bash");
        if let Some(p) = prev {
            std::env::set_var("SHELL", p);
        }
    }
}
