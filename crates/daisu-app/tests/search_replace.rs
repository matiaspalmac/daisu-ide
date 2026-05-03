use daisu_app::search::replacer::replace_in_workspace_inner;
use daisu_app::search::{ReplaceRequest, SearchHit, SearchOptions};

fn options(query: &str) -> SearchOptions {
    SearchOptions {
        query: query.to_string(),
        ..SearchOptions::default()
    }
}

fn hit(path: &str, line: u32, line_text: &str, start: u32, end: u32) -> SearchHit {
    SearchHit {
        id: uuid::Uuid::new_v4().to_string(),
        path: path.to_string(),
        line_no: line,
        line_text: line_text.to_string(),
        match_start_col: start,
        match_end_col: end,
    }
}

#[tokio::test]
async fn replace_writes_via_tempfile_rename() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("file.txt");
    tokio::fs::write(&path, "hello world\nhello again\n")
        .await
        .unwrap();
    let req = ReplaceRequest {
        options: options("hello"),
        replacement: "HELLO".to_string(),
        hits: vec![
            hit(&path.display().to_string(), 1, "hello world", 0, 5),
            hit(&path.display().to_string(), 2, "hello again", 0, 5),
        ],
        excluded_hit_ids: vec![],
    };
    let result = replace_in_workspace_inner(req).await.unwrap();
    assert_eq!(result.files_modified, 1);
    assert_eq!(result.total_replacements, 2);
    let contents = tokio::fs::read_to_string(&path).await.unwrap();
    assert_eq!(contents, "HELLO world\nHELLO again\n");
}

#[tokio::test]
async fn replace_skips_excluded_hit_ids() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("file.txt");
    tokio::fs::write(&path, "foo\nfoo\nfoo\n").await.unwrap();
    let h1 = hit(&path.display().to_string(), 1, "foo", 0, 3);
    let h2 = hit(&path.display().to_string(), 2, "foo", 0, 3);
    let h3 = hit(&path.display().to_string(), 3, "foo", 0, 3);
    let excluded = h2.id.clone();
    let req = ReplaceRequest {
        options: options("foo"),
        replacement: "BAR".to_string(),
        hits: vec![h1, h2, h3],
        excluded_hit_ids: vec![excluded],
    };
    let result = replace_in_workspace_inner(req).await.unwrap();
    assert_eq!(result.total_replacements, 2);
    let contents = tokio::fs::read_to_string(&path).await.unwrap();
    assert_eq!(contents, "BAR\nfoo\nBAR\n");
}

#[tokio::test]
async fn replace_returns_per_file_errors_without_aborting() {
    let tmp = tempfile::tempdir().unwrap();
    let good = tmp.path().join("good.txt");
    let missing = tmp.path().join("missing.txt");
    tokio::fs::write(&good, "needle\n").await.unwrap();
    let req = ReplaceRequest {
        options: options("needle"),
        replacement: "thread".to_string(),
        hits: vec![
            hit(&good.display().to_string(), 1, "needle", 0, 6),
            hit(&missing.display().to_string(), 1, "needle", 0, 6),
        ],
        excluded_hit_ids: vec![],
    };
    let result = replace_in_workspace_inner(req).await.unwrap();
    assert_eq!(result.files_modified, 1);
    assert_eq!(result.total_replacements, 1);
    assert_eq!(result.errors.len(), 1);
    assert_eq!(result.errors[0].path, missing.display().to_string());
    let contents = tokio::fs::read_to_string(&good).await.unwrap();
    assert_eq!(contents, "thread\n");
}

#[tokio::test]
async fn replace_preserves_line_endings_lf_and_crlf() {
    let tmp = tempfile::tempdir().unwrap();
    let lf = tmp.path().join("lf.txt");
    let crlf = tmp.path().join("crlf.txt");
    tokio::fs::write(&lf, "hello\nworld\n").await.unwrap();
    tokio::fs::write(&crlf, "hello\r\nworld\r\n").await.unwrap();
    let req = ReplaceRequest {
        options: options("hello"),
        replacement: "HI".to_string(),
        hits: vec![
            hit(&lf.display().to_string(), 1, "hello", 0, 5),
            hit(&crlf.display().to_string(), 1, "hello", 0, 5),
        ],
        excluded_hit_ids: vec![],
    };
    replace_in_workspace_inner(req).await.unwrap();
    assert_eq!(tokio::fs::read_to_string(&lf).await.unwrap(), "HI\nworld\n");
    assert_eq!(
        tokio::fs::read_to_string(&crlf).await.unwrap(),
        "HI\r\nworld\r\n"
    );
}

#[tokio::test]
async fn replace_atomicity_partial_write_leaves_no_temp_file() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("file.txt");
    tokio::fs::write(&path, "alpha\n").await.unwrap();
    let req = ReplaceRequest {
        options: options("alpha"),
        replacement: "beta".to_string(),
        hits: vec![hit(&path.display().to_string(), 1, "alpha", 0, 5)],
        excluded_hit_ids: vec![],
    };
    replace_in_workspace_inner(req).await.unwrap();

    let mut entries = tokio::fs::read_dir(tmp.path()).await.unwrap();
    let mut names: Vec<String> = Vec::new();
    while let Some(e) = entries.next_entry().await.unwrap() {
        names.push(e.file_name().to_string_lossy().into_owned());
    }
    names.sort();
    assert_eq!(names, vec!["file.txt"]);
}
