//! Smoke test that the `fake_lsp` mock harness spawns, completes the
//! initialize handshake, and replies to canned methods. Validates the
//! Task 0 infrastructure used by the request-sender tests.

mod common;

use serde_json::json;
use std::sync::Arc;

use daisu_lsp::requests;

#[tokio::test]
async fn fake_lsp_advertises_default_capabilities() {
    let client = common::spawn_mock_client(common::MockOpts::new()).await;
    let caps = client.capabilities();
    assert!(
        caps.definition_provider.is_some(),
        "definitionProvider missing"
    );
    assert!(
        caps.references_provider.is_some(),
        "referencesProvider missing"
    );
    assert!(
        caps.document_symbol_provider.is_some(),
        "documentSymbolProvider missing"
    );
    assert!(
        caps.workspace_symbol_provider.is_some(),
        "workspaceSymbolProvider missing"
    );
    client.shutdown().await;
}

#[tokio::test]
async fn fake_lsp_responds_to_canned_completion() {
    let response = json!({ "isIncomplete": false, "items": [] });
    let opts = common::MockOpts::new().with_response("textDocument/completion", response);
    let client = common::spawn_mock_client(opts).await;

    let arc = Arc::new(client);
    let params = lsp_types::CompletionParams {
        text_document_position: lsp_types::TextDocumentPositionParams {
            text_document: lsp_types::TextDocumentIdentifier {
                uri: lsp_types::Uri::from_str_unchecked("file:///x.rs"),
            },
            position: lsp_types::Position::new(0, 0),
        },
        work_done_progress_params: lsp_types::WorkDoneProgressParams::default(),
        partial_result_params: lsp_types::PartialResultParams::default(),
        context: None,
    };
    let (res, _) = requests::completion(arc.clone(), params).await.unwrap();
    assert!(res.0.is_some(), "completion should return Some");
    if let Ok(daisu_lsp_arc) = Arc::try_unwrap(arc) {
        daisu_lsp_arc.shutdown().await;
    }
}

trait UriFromStr {
    fn from_str_unchecked(s: &str) -> Self;
}

impl UriFromStr for lsp_types::Uri {
    fn from_str_unchecked(s: &str) -> Self {
        use std::str::FromStr;
        Self::from_str(s).expect("valid uri")
    }
}
