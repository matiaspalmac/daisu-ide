//! Integration tests for M4.3 advanced request senders (inlay hints,
//! semantic tokens, code actions, execute command). Each test boots a
//! `fake_lsp` mock with a canned response and exercises the sender
//! end-to-end.

mod common;

use std::str::FromStr;
use std::sync::Arc;

use serde_json::json;

use daisu_lsp::requests;
use lsp_types::{
    CodeActionContext, CodeActionParams, ExecuteCommandParams, InlayHintParams,
    PartialResultParams, Position, Range, SemanticTokensParams, TextDocumentIdentifier, Uri,
    WorkDoneProgressParams,
};

fn uri(s: &str) -> Uri {
    Uri::from_str(s).expect("valid uri")
}

fn inlay_params() -> InlayHintParams {
    InlayHintParams {
        text_document: TextDocumentIdentifier {
            uri: uri("file:///tmp/x.rs"),
        },
        range: Range {
            start: Position::new(0, 0),
            end: Position::new(50, 0),
        },
        work_done_progress_params: WorkDoneProgressParams::default(),
    }
}

#[tokio::test]
async fn inlay_hint_parses_label_string_response() {
    let response = json!([{
        "position": { "line": 3, "character": 8 },
        "label": ": String",
        "kind": 1
    }]);
    let opts = common::MockOpts::new().with_response("textDocument/inlayHint", response);
    let client = Arc::new(common::spawn_mock_client(opts).await);
    let (res, _) = requests::inlay_hint(client, inlay_params()).await.unwrap();
    assert_eq!(res.0.len(), 1);
    assert_eq!(res.0[0].position.line, 3);
}

#[tokio::test]
async fn inlay_hint_returns_empty_for_null() {
    let opts = common::MockOpts::new().with_response("textDocument/inlayHint", json!(null));
    let client = Arc::new(common::spawn_mock_client(opts).await);
    let (res, _) = requests::inlay_hint(client, inlay_params()).await.unwrap();
    assert!(res.0.is_empty());
}

#[tokio::test]
async fn semantic_tokens_full_parses_data_array() {
    let response = json!({
        "data": [0, 0, 5, 1, 0, 1, 4, 8, 2, 1]
    });
    let opts = common::MockOpts::new().with_response("textDocument/semanticTokens/full", response);
    let client = Arc::new(common::spawn_mock_client(opts).await);
    let params = SemanticTokensParams {
        text_document: TextDocumentIdentifier {
            uri: uri("file:///tmp/x.rs"),
        },
        work_done_progress_params: WorkDoneProgressParams::default(),
        partial_result_params: PartialResultParams::default(),
    };
    let (res, _) = requests::semantic_tokens_full(client, params)
        .await
        .unwrap();
    let tokens = res.0.expect("response not None");
    match tokens {
        lsp_types::SemanticTokensResult::Tokens(t) => {
            assert_eq!(t.data.len(), 2);
        }
        lsp_types::SemanticTokensResult::Partial(_) => panic!("expected Tokens, got Partial"),
    }
}

#[tokio::test]
async fn semantic_tokens_full_returns_none_for_null() {
    let opts =
        common::MockOpts::new().with_response("textDocument/semanticTokens/full", json!(null));
    let client = Arc::new(common::spawn_mock_client(opts).await);
    let params = SemanticTokensParams {
        text_document: TextDocumentIdentifier {
            uri: uri("file:///tmp/x.rs"),
        },
        work_done_progress_params: WorkDoneProgressParams::default(),
        partial_result_params: PartialResultParams::default(),
    };
    let (res, _) = requests::semantic_tokens_full(client, params)
        .await
        .unwrap();
    assert!(res.0.is_none());
}

#[tokio::test]
async fn code_action_parses_command_response() {
    let response = json!([{
        "title": "Add missing import",
        "command": "rust-analyzer.applyChange",
        "arguments": []
    }]);
    let opts = common::MockOpts::new().with_response("textDocument/codeAction", response);
    let client = Arc::new(common::spawn_mock_client(opts).await);
    let params = CodeActionParams {
        text_document: TextDocumentIdentifier {
            uri: uri("file:///tmp/x.rs"),
        },
        range: Range {
            start: Position::new(0, 0),
            end: Position::new(0, 5),
        },
        context: CodeActionContext::default(),
        work_done_progress_params: WorkDoneProgressParams::default(),
        partial_result_params: PartialResultParams::default(),
    };
    let (res, _) = requests::code_action(client, params).await.unwrap();
    assert_eq!(res.0.len(), 1);
}

#[tokio::test]
async fn code_action_parses_action_with_edit() {
    let response = json!([{
        "title": "Prefix with _",
        "kind": "quickfix",
        "edit": {
            "changes": {
                "file:///tmp/x.rs": [{
                    "range": { "start": {"line":0,"character":4}, "end": {"line":0,"character":7} },
                    "newText": "_foo"
                }]
            }
        }
    }]);
    let opts = common::MockOpts::new().with_response("textDocument/codeAction", response);
    let client = Arc::new(common::spawn_mock_client(opts).await);
    let params = CodeActionParams {
        text_document: TextDocumentIdentifier {
            uri: uri("file:///tmp/x.rs"),
        },
        range: Range {
            start: Position::new(0, 0),
            end: Position::new(0, 5),
        },
        context: CodeActionContext::default(),
        work_done_progress_params: WorkDoneProgressParams::default(),
        partial_result_params: PartialResultParams::default(),
    };
    let (res, _) = requests::code_action(client, params).await.unwrap();
    assert_eq!(res.0.len(), 1);
    match &res.0[0] {
        lsp_types::CodeActionOrCommand::CodeAction(a) => {
            assert_eq!(a.title, "Prefix with _");
            assert!(a.edit.is_some());
        }
        cmd @ lsp_types::CodeActionOrCommand::Command(_) => {
            panic!("expected CodeAction, got {cmd:?}")
        }
    }
}

#[tokio::test]
async fn code_action_returns_empty_for_null() {
    let opts = common::MockOpts::new().with_response("textDocument/codeAction", json!(null));
    let client = Arc::new(common::spawn_mock_client(opts).await);
    let params = CodeActionParams {
        text_document: TextDocumentIdentifier {
            uri: uri("file:///tmp/x.rs"),
        },
        range: Range {
            start: Position::new(0, 0),
            end: Position::new(0, 5),
        },
        context: CodeActionContext::default(),
        work_done_progress_params: WorkDoneProgressParams::default(),
        partial_result_params: PartialResultParams::default(),
    };
    let (res, _) = requests::code_action(client, params).await.unwrap();
    assert!(res.0.is_empty());
}

#[tokio::test]
async fn execute_command_round_trips_value_response() {
    let response = json!({"applied": true});
    let opts = common::MockOpts::new().with_response("workspace/executeCommand", response);
    let client = Arc::new(common::spawn_mock_client(opts).await);
    let params = ExecuteCommandParams {
        command: "rust-analyzer.applyChange".into(),
        arguments: vec![],
        work_done_progress_params: WorkDoneProgressParams::default(),
    };
    let (res, _) = requests::execute_command(client, params).await.unwrap();
    let value = res.0.expect("response not null");
    assert_eq!(value["applied"], json!(true));
}
