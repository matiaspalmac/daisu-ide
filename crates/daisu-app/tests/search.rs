use daisu_app::search::walker::build_walker;
use daisu_app::search::SearchOptions;

fn make_workspace(files: &[(&str, &str)]) -> tempfile::TempDir {
    let tmp = tempfile::tempdir().unwrap();
    for (rel, content) in files {
        let full = tmp.path().join(rel);
        if let Some(parent) = full.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(&full, content).unwrap();
    }
    tmp
}

#[test]
fn walks_respects_gitignore() {
    let tmp = make_workspace(&[
        (".gitignore", "ignored/\n*.log\n"),
        ("src/a.rs", "fn a() {}\n"),
        ("ignored/secret.rs", "fn secret() {}\n"),
        ("logs/app.log", "noise\n"),
    ]);
    let opts = SearchOptions::default();
    let walker = build_walker(tmp.path(), &opts).unwrap();
    let mut visited: Vec<String> = walker
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_some_and(|t| t.is_file()))
        .map(|e| {
            e.path()
                .strip_prefix(tmp.path())
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/")
        })
        .collect();
    visited.sort();
    assert!(visited.iter().any(|p| p == "src/a.rs"));
    assert!(!visited.iter().any(|p| p.starts_with("ignored/")));
    assert!(!visited.iter().any(|p| std::path::Path::new(p)
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("log"))));
}

#[test]
fn walks_applies_user_exclude_globs() {
    let tmp = make_workspace(&[("src/a.rs", "fn a() {}\n"), ("tests/b.rs", "fn b() {}\n")]);
    let opts = SearchOptions {
        exclude_globs: vec!["tests/**".to_string()],
        ..SearchOptions::default()
    };
    let walker = build_walker(tmp.path(), &opts).unwrap();
    let visited: Vec<String> = walker
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_some_and(|t| t.is_file()))
        .map(|e| {
            e.path()
                .strip_prefix(tmp.path())
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/")
        })
        .collect();
    assert!(visited.iter().any(|p| p == "src/a.rs"));
    assert!(!visited.iter().any(|p| p.starts_with("tests/")));
}

#[test]
fn walks_applies_user_include_globs() {
    let tmp = make_workspace(&[("src/a.rs", "fn a() {}\n"), ("README.md", "# hi\n")]);
    let opts = SearchOptions {
        include_globs: vec!["**/*.rs".to_string()],
        ..SearchOptions::default()
    };
    let walker = build_walker(tmp.path(), &opts).unwrap();
    let visited: Vec<String> = walker
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_some_and(|t| t.is_file()))
        .map(|e| {
            e.path()
                .strip_prefix(tmp.path())
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/")
        })
        .collect();
    assert!(visited.iter().any(|p| p == "src/a.rs"));
    assert!(!visited.iter().any(|p| p.ends_with("README.md")));
}
