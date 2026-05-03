use std::sync::{Arc, Mutex};

use daisu_app::search::matcher::build_matcher;
use daisu_app::search::registry;
use daisu_app::search::searcher::search_one_file;
use daisu_app::search::walker::build_walker;
use daisu_app::search::{SearchHit, SearchOptions};
use grep_searcher::sinks::UTF8;
use grep_searcher::Searcher;
use tokio_util::sync::CancellationToken;

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

#[test]
fn regex_disabled_treats_query_as_literal() {
    let opts = SearchOptions {
        query: "1+1".to_string(),
        regex: false,
        ..SearchOptions::default()
    };
    let matcher = build_matcher(&opts).unwrap();
    let mut hits = 0u32;
    Searcher::new()
        .search_slice(
            &matcher,
            b"1+1\n2+2\n",
            UTF8(|_, _| {
                hits += 1;
                Ok(true)
            }),
        )
        .unwrap();
    assert_eq!(hits, 1, "literal mode should match the exact string '1+1'");
}

#[test]
fn whole_word_wraps_with_word_boundaries() {
    let opts = SearchOptions {
        query: "foo".to_string(),
        whole_word: true,
        ..SearchOptions::default()
    };
    let matcher = build_matcher(&opts).unwrap();
    let mut hits = 0u32;
    Searcher::new()
        .search_slice(
            &matcher,
            b"foo bar foofoo\n",
            UTF8(|_, _| {
                hits += 1;
                Ok(true)
            }),
        )
        .unwrap();
    assert_eq!(hits, 1, "should match standalone 'foo' but not 'foofoo'");
}

#[test]
fn case_sensitive_default_off() {
    let opts = SearchOptions {
        query: "hello".to_string(),
        case_sensitive: false,
        ..SearchOptions::default()
    };
    let matcher = build_matcher(&opts).unwrap();
    let mut hits = 0u32;
    Searcher::new()
        .search_slice(
            &matcher,
            b"Hello World\nHELLO\n",
            UTF8(|_, _| {
                hits += 1;
                Ok(true)
            }),
        )
        .unwrap();
    assert_eq!(hits, 2);
}

#[test]
fn case_sensitive_on_matches_only_exact_case() {
    let opts = SearchOptions {
        query: "Hello".to_string(),
        case_sensitive: true,
        ..SearchOptions::default()
    };
    let matcher = build_matcher(&opts).unwrap();
    let mut hits = 0u32;
    Searcher::new()
        .search_slice(
            &matcher,
            b"Hello\nhello\nHELLO\n",
            UTF8(|_, _| {
                hits += 1;
                Ok(true)
            }),
        )
        .unwrap();
    assert_eq!(hits, 1);
}

#[test]
fn cancel_token_stops_walk_promptly() {
    let big = "match\nmatch\nmatch\n".repeat(2000);
    let tmp = make_workspace(&[("a.txt", big.as_str())]);
    let path = tmp.path().join("a.txt");
    let opts = SearchOptions {
        query: "match".to_string(),
        ..SearchOptions::default()
    };
    let matcher = build_matcher(&opts).unwrap();
    let token = CancellationToken::new();
    token.cancel();
    let collected: Arc<Mutex<Vec<SearchHit>>> = Arc::new(Mutex::new(Vec::new()));
    let collected_clone = Arc::clone(&collected);
    let outcome = search_one_file(&path, &matcher, &token, &opts, 0, move |batch| {
        collected_clone.lock().unwrap().extend(batch);
    })
    .unwrap();
    assert_eq!(outcome.hits_found, 0);
    assert_eq!(collected.lock().unwrap().len(), 0);
}

#[test]
fn streaming_emits_in_order_per_file() {
    let tmp = make_workspace(&[("ordered.txt", "alpha\nbeta\nalpha\ngamma\nalpha\n")]);
    let path = tmp.path().join("ordered.txt");
    let opts = SearchOptions {
        query: "alpha".to_string(),
        ..SearchOptions::default()
    };
    let matcher = build_matcher(&opts).unwrap();
    let token = CancellationToken::new();
    let collected: Arc<Mutex<Vec<SearchHit>>> = Arc::new(Mutex::new(Vec::new()));
    let collected_clone = Arc::clone(&collected);
    let outcome = search_one_file(&path, &matcher, &token, &opts, 0, move |batch| {
        collected_clone.lock().unwrap().extend(batch);
    })
    .unwrap();
    assert_eq!(outcome.hits_found, 3);
    let hits = collected.lock().unwrap();
    assert_eq!(hits[0].line_no, 1);
    assert_eq!(hits[1].line_no, 3);
    assert_eq!(hits[2].line_no, 5);
}

#[test]
fn binary_files_quit_on_null_byte() {
    let tmp = make_workspace(&[]);
    let path = tmp.path().join("binary.bin");
    std::fs::write(&path, b"prefix\0matchhere\n").unwrap();
    let opts = SearchOptions {
        query: "match".to_string(),
        ..SearchOptions::default()
    };
    let matcher = build_matcher(&opts).unwrap();
    let token = CancellationToken::new();
    let collected: Arc<Mutex<Vec<SearchHit>>> = Arc::new(Mutex::new(Vec::new()));
    let collected_clone = Arc::clone(&collected);
    let outcome = search_one_file(&path, &matcher, &token, &opts, 0, move |batch| {
        collected_clone.lock().unwrap().extend(batch);
    })
    .unwrap();
    assert_eq!(outcome.hits_found, 0);
}

#[test]
fn max_results_respected_truncated_flag_set() {
    let mut content = String::new();
    for _ in 0..200 {
        content.push_str("hit\n");
    }
    let tmp = make_workspace(&[("big.txt", content.as_str())]);
    let path = tmp.path().join("big.txt");
    let opts = SearchOptions {
        query: "hit".to_string(),
        max_results: 50,
        ..SearchOptions::default()
    };
    let matcher = build_matcher(&opts).unwrap();
    let token = CancellationToken::new();
    let collected: Arc<Mutex<Vec<SearchHit>>> = Arc::new(Mutex::new(Vec::new()));
    let collected_clone = Arc::clone(&collected);
    let outcome = search_one_file(&path, &matcher, &token, &opts, 0, move |batch| {
        collected_clone.lock().unwrap().extend(batch);
    })
    .unwrap();
    assert_eq!(outcome.hits_found, 50);
    assert!(outcome.truncated);
}

#[test]
fn registry_cancel_marks_token() {
    let token = registry::register("phase5-test-id");
    registry::cancel("phase5-test-id");
    assert!(token.is_cancelled());
    registry::cleanup("phase5-test-id");
}
