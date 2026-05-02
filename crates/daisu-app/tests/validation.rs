use daisu_app::validation::validate_filename;

#[test]
fn accepts_normal_names() {
    for name in [
        "App.tsx",
        "main.rs",
        "README.md",
        "_underscore",
        "name with spaces.txt",
        "тест.txt",
        "测试.txt",
        "テスト.txt",
        "a.b.c.d",
        "x",
        "1.txt",
    ] {
        assert!(validate_filename(name).is_ok(), "expected ok: {name}");
    }
}

#[test]
fn rejects_empty_or_whitespace() {
    for name in ["", " ", "   ", "\t"] {
        assert!(validate_filename(name).is_err(), "expected err: {name:?}");
    }
}

#[test]
fn rejects_too_long_name() {
    let long = "a".repeat(256);
    assert!(validate_filename(&long).is_err());
    let ok = "a".repeat(255);
    assert!(validate_filename(&ok).is_ok());
}

#[test]
fn rejects_illegal_chars() {
    for bad in [
        "foo<bar", "foo>bar", "foo:bar", "foo\"bar", "foo/bar", "foo\\bar", "foo|bar", "foo?bar",
        "foo*bar",
    ] {
        assert!(validate_filename(bad).is_err(), "expected err: {bad}");
    }
}

#[test]
fn rejects_control_chars() {
    for code in [0x00u8, 0x01, 0x07, 0x0a, 0x1f, 0x7f] {
        let s = format!("a{}b", code as char);
        assert!(validate_filename(&s).is_err(), "expected err: {s:?}");
    }
}

#[test]
fn rejects_windows_reserved_exact_match_case_insensitive() {
    for name in [
        "CON", "con", "Con", "PRN", "AUX", "NUL", "COM1", "com9", "LPT1", "lpt9",
    ] {
        assert!(validate_filename(name).is_err(), "expected err: {name}");
    }
}

#[test]
fn rejects_windows_reserved_with_extension() {
    for name in ["CON.txt", "con.log", "PRN.json"] {
        assert!(validate_filename(name).is_err(), "expected err: {name}");
    }
}

#[test]
fn rejects_leading_or_trailing_space_or_dot() {
    // Note: leading single dot is allowed (covered by allows_dot_files_with_safe_stems
    // below). This test only covers leading/trailing space and trailing dot.
    for name in [" leading.txt", "trailing.txt ", "trailing."] {
        assert!(validate_filename(name).is_err(), "expected err: {name}");
    }
}

#[test]
fn allows_dot_files_with_safe_stems() {
    // Phase 2 allows dotfiles (".gitignore", ".env") since they're ubiquitous in dev
    // workflows. Only purely-dot names ("." / ".." / "...") are rejected.
    for name in [".gitignore", ".env", ".eslintrc.json"] {
        assert!(validate_filename(name).is_ok(), "expected ok: {name}");
    }
    for name in [".", "..", "..."] {
        assert!(validate_filename(name).is_err(), "expected err: {name}");
    }
}
