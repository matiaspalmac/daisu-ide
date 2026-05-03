use daisu_app::commands::themes::{list_bundled_themes_inner, read_theme_json_inner};

#[test]
fn list_bundled_themes_returns_three() {
    let list = list_bundled_themes_inner();
    assert_eq!(list.len(), 3);
    let ids: Vec<&str> = list.iter().map(|d| d.id.as_str()).collect();
    assert!(ids.contains(&"tron-dark"));
    assert!(ids.contains(&"daisu-dark"));
    assert!(ids.contains(&"daisu-light"));
}

#[test]
fn list_bundled_themes_carries_kind() {
    let list = list_bundled_themes_inner();
    let dark = list.iter().find(|d| d.id == "daisu-dark").unwrap();
    let light = list.iter().find(|d| d.id == "daisu-light").unwrap();
    assert_eq!(dark.kind, "dark");
    assert_eq!(light.kind, "light");
}

#[test]
fn read_theme_json_dark_parses_to_object() {
    let value = read_theme_json_inner("daisu-dark").unwrap();
    let name = value.get("name").and_then(|v| v.as_str()).unwrap();
    assert_eq!(name, "Daisu Dark");
    let kind = value.get("type").and_then(|v| v.as_str()).unwrap();
    assert_eq!(kind, "dark");
    let colors = value.get("colors").unwrap();
    assert!(colors.is_object());
}

#[test]
fn read_theme_json_light_parses_to_object() {
    let value = read_theme_json_inner("daisu-light").unwrap();
    let name = value.get("name").and_then(|v| v.as_str()).unwrap();
    assert_eq!(name, "Daisu Light");
    let kind = value.get("type").and_then(|v| v.as_str()).unwrap();
    assert_eq!(kind, "light");
}

#[test]
fn read_theme_json_unknown_id_returns_not_found() {
    let err = read_theme_json_inner("nope").unwrap_err();
    assert!(matches!(err, daisu_app::AppError::NotFound { .. }));
}

#[test]
fn bundled_themes_have_required_keys() {
    for id in ["tron-dark", "daisu-dark", "daisu-light"] {
        let value = read_theme_json_inner(id).unwrap();
        assert!(value.get("name").is_some(), "{id} missing name");
        assert!(value.get("type").is_some(), "{id} missing type");
        assert!(value.get("colors").is_some(), "{id} missing colors");
        assert!(
            value.get("tokenColors").is_some(),
            "{id} missing tokenColors"
        );
    }
}
