use daisu_app::error::AppError;

#[test]
fn serializes_invalid_name_with_kind_message_context() {
    let err = AppError::invalid_name("Reserved Windows name 'CON'", "CON");
    let json = serde_json::to_value(&err).unwrap();
    assert_eq!(json["kind"], "InvalidName");
    assert_eq!(json["message"], "Reserved Windows name 'CON'");
    assert_eq!(json["context"]["name"], "CON");
}

#[test]
fn serializes_already_exists_with_path_context() {
    let err = AppError::already_exists("C:\\foo\\bar.txt");
    let json = serde_json::to_value(&err).unwrap();
    assert_eq!(json["kind"], "AlreadyExists");
    assert_eq!(json["context"]["path"], "C:\\foo\\bar.txt");
}

#[test]
fn serializes_not_found_with_path_context() {
    let err = AppError::not_found("C:\\nope");
    let json = serde_json::to_value(&err).unwrap();
    assert_eq!(json["kind"], "NotFound");
    assert_eq!(json["context"]["path"], "C:\\nope");
}

#[test]
fn serializes_io_error_with_kind_string() {
    let io = std::io::Error::new(std::io::ErrorKind::PermissionDenied, "denied");
    let err: AppError = io.into();
    let json = serde_json::to_value(&err).unwrap();
    assert_eq!(json["kind"], "IoError");
    assert_eq!(json["context"]["io_kind"], "PermissionDenied");
}

#[test]
fn serializes_cancelled_with_no_context() {
    let err = AppError::Cancelled;
    let json = serde_json::to_value(&err).unwrap();
    assert_eq!(json["kind"], "Cancelled");
    assert_eq!(json["context"], serde_json::Value::Null);
}

#[test]
fn preserves_invalid_utf8_for_phase_1_callers() {
    let err = AppError::InvalidUtf8;
    let json = serde_json::to_value(&err).unwrap();
    assert_eq!(json["kind"], "InvalidUtf8");
}
