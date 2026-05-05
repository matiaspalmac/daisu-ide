//! Integration tests for M4.2a request senders. Each test boots a
//! `fake_lsp` mock with a canned response and exercises the sender end-to-end.

mod common;

use std::str::FromStr;
use std::sync::Arc;

use serde_json::json;

use daisu_lsp::requests;
use lsp_types::{
    DocumentSymbolParams, DocumentSymbolResponse, GotoDefinitionParams, GotoDefinitionResponse,
    PartialResultParams, Position, ReferenceContext, ReferenceParams, TextDocumentIdentifier,
    TextDocumentPositionParams, Uri, WorkDoneProgressParams, WorkspaceSymbolParams,
    WorkspaceSymbolResponse,
};

fn uri(s: &str) -> Uri {
    Uri::from_str(s).expect("valid uri")
}

fn def_params() -> GotoDefinitionParams {
    GotoDefinitionParams {
        text_document_position_params: TextDocumentPositionParams {
            text_document: TextDocumentIdentifier {
                uri: uri("file:///tmp/x.rs"),
            },
            position: Position::new(0, 0),
        },
        work_done_progress_params: WorkDoneProgressParams::default(),
        partial_result_params: PartialResultParams::default(),
    }
}

#[tokio::test]
async fn definition_parses_location_link_array() {
    let response = json!([{
        "originSelectionRange": {
            "start": { "line": 0, "character": 0 },
            "end":   { "line": 0, "character": 5 }
        },
        "targetUri": "file:///tmp/foo.rs",
        "targetRange": {
            "start": { "line": 10, "character": 0 },
            "end":   { "line": 12, "character": 1 }
        },
        "targetSelectionRange": {
            "start": { "line": 10, "character": 4 },
            "end":   { "line": 10, "character": 7 }
        }
    }]);
    let opts = common::MockOpts::new().with_response("textDocument/definition", response);
    let client = Arc::new(common::spawn_mock_client(opts).await);
    let (res, _) = requests::definition(client.clone(), def_params())
        .await
        .unwrap();
    let inner = res.0.expect("response not None");
    match inner {
        GotoDefinitionResponse::Link(links) => assert_eq!(links.len(), 1),
        other => panic!("expected Link, got {other:?}"),
    }
}

#[tokio::test]
async fn definition_parses_location_array() {
    let response = json!([{
        "uri": "file:///tmp/foo.ts",
        "range": {
            "start": { "line": 5, "character": 2 },
            "end":   { "line": 5, "character": 8 }
        }
    }]);
    let opts = common::MockOpts::new().with_response("textDocument/definition", response);
    let client = Arc::new(common::spawn_mock_client(opts).await);
    let (res, _) = requests::definition(client.clone(), def_params())
        .await
        .unwrap();
    match res.0.expect("response not None") {
        GotoDefinitionResponse::Array(locs) => assert_eq!(locs.len(), 1),
        other => panic!("expected Array, got {other:?}"),
    }
}

#[tokio::test]
async fn definition_parses_single_location_scalar() {
    let response = json!({
        "uri": "file:///tmp/foo.rs",
        "range": {
            "start": { "line": 0, "character": 0 },
            "end":   { "line": 0, "character": 5 }
        }
    });
    let opts = common::MockOpts::new().with_response("textDocument/definition", response);
    let client = Arc::new(common::spawn_mock_client(opts).await);
    let (res, _) = requests::definition(client.clone(), def_params())
        .await
        .unwrap();
    match res.0.expect("response not None") {
        GotoDefinitionResponse::Scalar(_) => {}
        other => panic!("expected Scalar, got {other:?}"),
    }
}

#[tokio::test]
async fn definition_returns_none_for_null_response() {
    let opts = common::MockOpts::new().with_response("textDocument/definition", json!(null));
    let client = Arc::new(common::spawn_mock_client(opts).await);
    let (res, _) = requests::definition(client.clone(), def_params())
        .await
        .unwrap();
    assert!(res.0.is_none());
}

fn refs_params(include_decl: bool) -> ReferenceParams {
    ReferenceParams {
        text_document_position: TextDocumentPositionParams {
            text_document: TextDocumentIdentifier {
                uri: uri("file:///tmp/x.rs"),
            },
            position: Position::new(0, 0),
        },
        work_done_progress_params: WorkDoneProgressParams::default(),
        partial_result_params: PartialResultParams::default(),
        context: ReferenceContext {
            include_declaration: include_decl,
        },
    }
}

#[tokio::test]
async fn references_parses_location_array() {
    let response = json!([
        { "uri": "file:///a.rs", "range": { "start": { "line": 1, "character": 0 }, "end": { "line": 1, "character": 5 } } },
        { "uri": "file:///b.rs", "range": { "start": { "line": 2, "character": 0 }, "end": { "line": 2, "character": 5 } } }
    ]);
    let opts = common::MockOpts::new().with_response("textDocument/references", response);
    let client = Arc::new(common::spawn_mock_client(opts).await);
    let (res, _) = requests::references(client.clone(), refs_params(true))
        .await
        .unwrap();
    assert_eq!(res.len(), 2);
}

#[tokio::test]
async fn references_returns_empty_for_null() {
    let opts = common::MockOpts::new().with_response("textDocument/references", json!(null));
    let client = Arc::new(common::spawn_mock_client(opts).await);
    let (res, _) = requests::references(client.clone(), refs_params(false))
        .await
        .unwrap();
    assert!(res.is_empty());
}

fn doc_sym_params() -> DocumentSymbolParams {
    DocumentSymbolParams {
        text_document: TextDocumentIdentifier {
            uri: uri("file:///tmp/x.rs"),
        },
        work_done_progress_params: WorkDoneProgressParams::default(),
        partial_result_params: PartialResultParams::default(),
    }
}

#[tokio::test]
async fn document_symbol_parses_nested_tree_with_children() {
    let response = json!([{
        "name": "MyStruct",
        "kind": 23,
        "range": { "start": { "line": 0, "character": 0 }, "end": { "line": 10, "character": 1 } },
        "selectionRange": { "start": { "line": 0, "character": 7 }, "end": { "line": 0, "character": 15 } },
        "children": [{
            "name": "field1",
            "kind": 8,
            "range": { "start": { "line": 1, "character": 4 }, "end": { "line": 1, "character": 20 } },
            "selectionRange": { "start": { "line": 1, "character": 4 }, "end": { "line": 1, "character": 10 } }
        }]
    }]);
    let opts = common::MockOpts::new().with_response("textDocument/documentSymbol", response);
    let client = Arc::new(common::spawn_mock_client(opts).await);
    let (res, _) = requests::document_symbol(client.clone(), doc_sym_params())
        .await
        .unwrap();
    match res.0.expect("response not None") {
        DocumentSymbolResponse::Nested(syms) => {
            assert_eq!(syms.len(), 1);
            assert_eq!(syms[0].children.as_ref().map_or(0, std::vec::Vec::len), 1);
        }
        other => panic!("expected Nested, got {other:?}"),
    }
}

#[tokio::test]
async fn document_symbol_parses_flat_legacy_response() {
    let response = json!([{
        "name": "foo",
        "kind": 12,
        "location": {
            "uri": "file:///tmp/x.rs",
            "range": { "start": { "line": 0, "character": 0 }, "end": { "line": 0, "character": 3 } }
        }
    }]);
    let opts = common::MockOpts::new().with_response("textDocument/documentSymbol", response);
    let client = Arc::new(common::spawn_mock_client(opts).await);
    let (res, _) = requests::document_symbol(client.clone(), doc_sym_params())
        .await
        .unwrap();
    match res.0.expect("response not None") {
        DocumentSymbolResponse::Flat(syms) => assert_eq!(syms.len(), 1),
        other => panic!("expected Flat, got {other:?}"),
    }
}

fn ws_sym_params(query: &str) -> WorkspaceSymbolParams {
    WorkspaceSymbolParams {
        query: query.into(),
        work_done_progress_params: WorkDoneProgressParams::default(),
        partial_result_params: PartialResultParams::default(),
    }
}

#[tokio::test]
async fn workspace_symbol_parses_query_response() {
    let response = json!([{
        "name": "MyStruct",
        "kind": 23,
        "location": {
            "uri": "file:///tmp/x.rs",
            "range": { "start": { "line": 0, "character": 0 }, "end": { "line": 0, "character": 8 } }
        },
        "containerName": "module_a"
    }]);
    let opts = common::MockOpts::new().with_response("workspace/symbol", response);
    let client = Arc::new(common::spawn_mock_client(opts).await);
    let (res, _) = requests::workspace_symbol(client.clone(), ws_sym_params("My"))
        .await
        .unwrap();
    match res.0.expect("response not None") {
        WorkspaceSymbolResponse::Flat(syms) => {
            assert_eq!(syms.len(), 1);
            assert_eq!(syms[0].name, "MyStruct");
        }
        other => panic!("expected Flat, got {other:?}"),
    }
}

#[tokio::test]
async fn workspace_symbol_handles_empty_response() {
    let opts = common::MockOpts::new().with_response("workspace/symbol", json!([]));
    let client = Arc::new(common::spawn_mock_client(opts).await);
    let (res, _) = requests::workspace_symbol(client.clone(), ws_sym_params("xyzzy"))
        .await
        .unwrap();
    match res.0.expect("response not None") {
        WorkspaceSymbolResponse::Flat(syms) => assert!(syms.is_empty()),
        WorkspaceSymbolResponse::Nested(syms) => assert!(syms.is_empty()),
    }
}
