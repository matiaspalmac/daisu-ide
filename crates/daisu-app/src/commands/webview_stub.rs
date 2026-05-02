#[tauri::command]
#[must_use]
pub fn ping() -> &'static str {
    "pong"
}

#[cfg(test)]
mod tests {
    use super::ping;

    #[test]
    fn ping_returns_pong() {
        assert_eq!(ping(), "pong");
    }
}
