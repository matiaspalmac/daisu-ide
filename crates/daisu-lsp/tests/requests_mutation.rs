//! Integration tests for M4.2c mutation request senders (rename + format).
//! Each test boots a `fake_lsp` mock with a canned response and exercises the
//! sender end-to-end.

mod common;

use std::str::FromStr;
use std::sync::Arc;

use serde_json::json;

use daisu_lsp::requests;
use lsp_types::{
    DocumentFormattingParams, DocumentRangeFormattingParams, FormattingOptions, Position,
    PrepareRenameResponse, Range, RenameParams, TextDocumentIdentifier, TextDocumentPositionParams,
    Uri, WorkDoneProgressParams,
};

fn uri(s: &str) -> Uri {
    Uri::from_str(s).expect("valid uri")
}

fn pos_params() -> TextDocumentPositionParams {
    TextDocumentPositionParams {
        text_document: TextDocumentIdentifier {
            uri: uri("file:///tmp/x.rs"),
        },
        position: Position::new(0, 0),
    }
}

#[tokio::test]
async fn prepare_rename_parses_range_response() {
    let response = json!({
        "start": { "line": 3, "character": 8 },
        "end":   { "line": 3, "character": 16 }
    });
    let opts = common::MockOpts::new().with_response("textDocument/prepareRename", response);
    let client = Arc::new(common::spawn_mock_client(opts).await);
    let (res, _) = requests::prepare_rename(client, pos_params())
        .await
        .unwrap();
    match res.0.expect("response not None") {
        PrepareRenameResponse::Range(r) => {
            assert_eq!(r.start.line, 3);
            assert_eq!(r.end.character, 16);
        }
        other => panic!("expected Range, got {other:?}"),
    }
}

#[tokio::test]
async fn prepare_rename_parses_placeholder_response() {
    let response = json!({
        "range": { "start": { "line": 2, "character": 4 }, "end": { "line": 2, "character": 10 } },
        "placeholder": "renamed_var"
    });
    let opts = common::MockOpts::new().with_response("textDocument/prepareRename", response);
    let client = Arc::new(common::spawn_mock_client(opts).await);
    let (res, _) = requests::prepare_rename(client, pos_params())
        .await
        .unwrap();
    match res.0.expect("response not None") {
        PrepareRenameResponse::RangeWithPlaceholder { range, placeholder } => {
            assert_eq!(range.start.line, 2);
            assert_eq!(placeholder, "renamed_var");
        }
        other => panic!("expected RangeWithPlaceholder, got {other:?}"),
    }
}

#[tokio::test]
async fn prepare_rename_returns_none_for_null() {
    let opts = common::MockOpts::new().with_response("textDocument/prepareRename", json!(null));
    let client = Arc::new(common::spawn_mock_client(opts).await);
    let (res, _) = requests::prepare_rename(client, pos_params())
        .await
        .unwrap();
    assert!(res.0.is_none());
}

#[allow(clippy::mutable_key_type)] // WorkspaceEdit.changes uses lsp Uri keys
#[tokio::test]
async fn rename_parses_changes_map_response() {
    let response = json!({
        "changes": {
            "file:///tmp/x.rs": [
                {
                    "range": { "start": { "line": 0, "character": 0 }, "end": { "line": 0, "character": 3 } },
                    "newText": "bar"
                },
                {
                    "range": { "start": { "line": 5, "character": 8 }, "end": { "line": 5, "character": 11 } },
                    "newText": "bar"
                }
            ]
        }
    });
    let opts = common::MockOpts::new().with_response("textDocument/rename", response);
    let client = Arc::new(common::spawn_mock_client(opts).await);
    let params = RenameParams {
        text_document_position: pos_params(),
        new_name: "bar".into(),
        work_done_progress_params: WorkDoneProgressParams::default(),
    };
    let (res, _) = requests::rename(client, params).await.unwrap();
    let edit = res.0.expect("response not None");
    let changes = edit.changes.expect("changes map present");
    assert_eq!(changes.len(), 1);
    let edits = changes.values().next().expect("at least one file's edits");
    assert_eq!(edits.len(), 2);
    assert_eq!(edits[0].new_text, "bar");
}

#[tokio::test]
async fn rename_parses_document_changes_response() {
    let response = json!({
        "documentChanges": [
            {
                "textDocument": { "uri": "file:///tmp/x.rs", "version": 4 },
                "edits": [
                    {
                        "range": { "start": { "line": 0, "character": 0 }, "end": { "line": 0, "character": 3 } },
                        "newText": "baz"
                    }
                ]
            }
        ]
    });
    let opts = common::MockOpts::new().with_response("textDocument/rename", response);
    let client = Arc::new(common::spawn_mock_client(opts).await);
    let params = RenameParams {
        text_document_position: pos_params(),
        new_name: "baz".into(),
        work_done_progress_params: WorkDoneProgressParams::default(),
    };
    let (res, _) = requests::rename(client, params).await.unwrap();
    let edit = res.0.expect("response not None");
    assert!(edit.document_changes.is_some());
}

#[tokio::test]
async fn rename_returns_none_for_null() {
    let opts = common::MockOpts::new().with_response("textDocument/rename", json!(null));
    let client = Arc::new(common::spawn_mock_client(opts).await);
    let params = RenameParams {
        text_document_position: pos_params(),
        new_name: "x".into(),
        work_done_progress_params: WorkDoneProgressParams::default(),
    };
    let (res, _) = requests::rename(client, params).await.unwrap();
    assert!(res.0.is_none());
}

#[tokio::test]
async fn formatting_parses_text_edits_response() {
    let response = json!([
        {
            "range": { "start": { "line": 0, "character": 0 }, "end": { "line": 0, "character": 4 } },
            "newText": "    "
        },
        {
            "range": { "start": { "line": 1, "character": 0 }, "end": { "line": 1, "character": 0 } },
            "newText": "// formatted\n"
        }
    ]);
    let opts = common::MockOpts::new().with_response("textDocument/formatting", response);
    let client = Arc::new(common::spawn_mock_client(opts).await);
    let params = DocumentFormattingParams {
        text_document: TextDocumentIdentifier {
            uri: uri("file:///tmp/x.rs"),
        },
        options: FormattingOptions {
            tab_size: 4,
            insert_spaces: true,
            ..Default::default()
        },
        work_done_progress_params: WorkDoneProgressParams::default(),
    };
    let (res, _) = requests::formatting(client, params).await.unwrap();
    assert_eq!(res.0.len(), 2);
    assert_eq!(res.0[1].new_text, "// formatted\n");
}

#[tokio::test]
async fn formatting_returns_empty_for_null() {
    let opts = common::MockOpts::new().with_response("textDocument/formatting", json!(null));
    let client = Arc::new(common::spawn_mock_client(opts).await);
    let params = DocumentFormattingParams {
        text_document: TextDocumentIdentifier {
            uri: uri("file:///tmp/x.rs"),
        },
        options: FormattingOptions::default(),
        work_done_progress_params: WorkDoneProgressParams::default(),
    };
    let (res, _) = requests::formatting(client, params).await.unwrap();
    assert!(res.0.is_empty());
}

#[tokio::test]
async fn range_formatting_parses_text_edits_response() {
    let response = json!([{
        "range": { "start": { "line": 2, "character": 0 }, "end": { "line": 2, "character": 12 } },
        "newText": "let x = 1;"
    }]);
    let opts = common::MockOpts::new().with_response("textDocument/rangeFormatting", response);
    let client = Arc::new(common::spawn_mock_client(opts).await);
    let params = DocumentRangeFormattingParams {
        text_document: TextDocumentIdentifier {
            uri: uri("file:///tmp/x.rs"),
        },
        range: Range {
            start: Position::new(2, 0),
            end: Position::new(2, 12),
        },
        options: FormattingOptions::default(),
        work_done_progress_params: WorkDoneProgressParams::default(),
    };
    let (res, _) = requests::range_formatting(client, params).await.unwrap();
    assert_eq!(res.0.len(), 1);
    assert_eq!(res.0[0].new_text, "let x = 1;");
}
