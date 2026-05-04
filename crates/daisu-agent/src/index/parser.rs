//! Language detection + tree-sitter symbol extraction.
//!
//! Each supported language defines a static query string that captures
//! function defs, type/struct/class defs, and exports. The capture name
//! `@kind.name` form drives the [`SymbolKind`] mapping below.

use std::path::Path;

use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use tree_sitter::{Parser, Query, QueryCursor, StreamingIterator};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Language {
    Rust,
    TypeScript,
    Tsx,
    Python,
    Go,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SymbolKind {
    Function,
    Method,
    Struct,
    Class,
    Interface,
    Enum,
    Type,
    Trait,
    Module,
    Const,
}

impl SymbolKind {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Function => "function",
            Self::Method => "method",
            Self::Struct => "struct",
            Self::Class => "class",
            Self::Interface => "interface",
            Self::Enum => "enum",
            Self::Type => "type",
            Self::Trait => "trait",
            Self::Module => "module",
            Self::Const => "const",
        }
    }

    #[must_use]
    pub fn from_capture(capture: &str) -> Option<Self> {
        match capture {
            "function" => Some(Self::Function),
            "method" => Some(Self::Method),
            "struct" => Some(Self::Struct),
            "class" => Some(Self::Class),
            "interface" => Some(Self::Interface),
            "enum" => Some(Self::Enum),
            "type" => Some(Self::Type),
            "trait" => Some(Self::Trait),
            "module" => Some(Self::Module),
            "const" => Some(Self::Const),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Symbol {
    pub kind: SymbolKind,
    pub name: String,
    pub line_start: u32,
    pub line_end: u32,
    pub signature: Option<String>,
}

#[must_use]
pub fn detect_language(path: &Path) -> Option<Language> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    match ext.as_str() {
        "rs" => Some(Language::Rust),
        "ts" | "mts" | "cts" => Some(Language::TypeScript),
        "tsx" => Some(Language::Tsx),
        "py" | "pyi" => Some(Language::Python),
        "go" => Some(Language::Go),
        _ => None,
    }
}

/// SHA-1 hex digest of the file contents — used for incremental rebuild
/// detection (cheap to compute, collision-resistant enough for cache keys).
#[must_use]
pub fn content_hash(content: &str) -> String {
    let mut hasher = Sha1::new();
    hasher.update(content.as_bytes());
    let out = hasher.finalize();
    let mut s = String::with_capacity(out.len() * 2);
    for b in out {
        use std::fmt::Write;
        let _ = write!(&mut s, "{b:02x}");
    }
    s
}

const RUST_QUERY: &str = r"
(function_item name: (identifier) @function.name) @function
(struct_item name: (type_identifier) @struct.name) @struct
(enum_item name: (type_identifier) @enum.name) @enum
(trait_item name: (type_identifier) @trait.name) @trait
(impl_item) @impl
(type_item name: (type_identifier) @type.name) @type
(mod_item name: (identifier) @module.name) @module
(const_item name: (identifier) @const.name) @const
";

const TS_QUERY: &str = r"
(function_declaration name: (identifier) @function.name) @function
(class_declaration name: (type_identifier) @class.name) @class
(interface_declaration name: (type_identifier) @interface.name) @interface
(type_alias_declaration name: (type_identifier) @type.name) @type
(enum_declaration name: (identifier) @enum.name) @enum
(method_definition name: (property_identifier) @method.name) @method
";

const PY_QUERY: &str = r"
(function_definition name: (identifier) @function.name) @function
(class_definition name: (identifier) @class.name) @class
";

const GO_QUERY: &str = r"
(function_declaration name: (identifier) @function.name) @function
(method_declaration name: (field_identifier) @method.name) @method
(type_declaration (type_spec name: (type_identifier) @type.name)) @type
";

fn language_for(lang: Language) -> tree_sitter::Language {
    match lang {
        Language::Rust => tree_sitter_rust::LANGUAGE.into(),
        Language::TypeScript => tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
        Language::Tsx => tree_sitter_typescript::LANGUAGE_TSX.into(),
        Language::Python => tree_sitter_python::LANGUAGE.into(),
        Language::Go => tree_sitter_go::LANGUAGE.into(),
    }
}

fn query_for(lang: Language) -> &'static str {
    match lang {
        Language::Rust => RUST_QUERY,
        Language::TypeScript | Language::Tsx => TS_QUERY,
        Language::Python => PY_QUERY,
        Language::Go => GO_QUERY,
    }
}

/// Parse `content` and return all captured symbols. Returns an empty vec on
/// any parser/query failure — the indexer treats malformed files as empty
/// rather than aborting a rebuild.
#[must_use]
pub fn parse_symbols(lang: Language, content: &str) -> Vec<Symbol> {
    let ts_lang = language_for(lang);
    let mut parser = Parser::new();
    if parser.set_language(&ts_lang).is_err() {
        return Vec::new();
    }
    let Some(tree) = parser.parse(content, None) else {
        return Vec::new();
    };
    let Ok(query) = Query::new(&ts_lang, query_for(lang)) else {
        return Vec::new();
    };

    let bytes = content.as_bytes();
    let capture_names = query.capture_names();
    let mut cursor = QueryCursor::new();
    let mut out = Vec::new();
    let mut matches = cursor.matches(&query, tree.root_node(), bytes);

    while let Some(m) = matches.next() {
        // A match groups one outer node (e.g. @function) with one inner
        // name capture (e.g. @function.name). We pick the outer node for
        // line ranges + signature, and the *.name capture for the symbol
        // name. Capture names ending in `.name` are the inner ones.
        let mut outer: Option<(SymbolKind, tree_sitter::Node)> = None;
        let mut name: Option<String> = None;

        for cap in m.captures {
            let cap_name = capture_names[cap.index as usize];
            if let Some((kind_str, suffix)) = cap_name.split_once('.') {
                if suffix == "name" {
                    if let Ok(text) = cap.node.utf8_text(bytes) {
                        name = Some(text.to_string());
                    }
                    if outer.is_none() {
                        if let Some(kind) = SymbolKind::from_capture(kind_str) {
                            outer = Some((kind, cap.node));
                        }
                    }
                }
            } else if let Some(kind) = SymbolKind::from_capture(cap_name) {
                outer = Some((kind, cap.node));
            }
        }

        let Some((kind, node)) = outer else { continue };
        let Some(name) = name else { continue };
        let line_start = node.start_position().row as u32 + 1;
        let line_end = node.end_position().row as u32 + 1;
        let signature = first_line_snippet(content, &node);
        out.push(Symbol {
            kind,
            name,
            line_start,
            line_end,
            signature,
        });
    }
    out
}

fn first_line_snippet(content: &str, node: &tree_sitter::Node) -> Option<String> {
    let start = node.start_byte();
    let end = node.end_byte().min(content.len());
    let slice = content.get(start..end)?;
    let line = slice.lines().next()?.trim();
    if line.is_empty() {
        None
    } else {
        let truncated: String = line.chars().take(160).collect();
        Some(truncated)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_rust_extension() {
        assert_eq!(
            detect_language(Path::new("foo/bar.rs")),
            Some(Language::Rust)
        );
    }

    #[test]
    fn parses_rust_function() {
        let src = "fn hello() {}\nstruct Foo;\n";
        let syms = parse_symbols(Language::Rust, src);
        assert!(syms.iter().any(|s| s.name == "hello"));
        assert!(syms.iter().any(|s| s.name == "Foo"));
    }

    #[test]
    fn parses_python_class() {
        let src = "class Foo:\n    def bar(self):\n        pass\n";
        let syms = parse_symbols(Language::Python, src);
        assert!(syms.iter().any(|s| s.name == "Foo"));
        assert!(syms.iter().any(|s| s.name == "bar"));
    }
}
