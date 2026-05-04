//! OS keychain wrapper for provider API keys.
//!
//! Each provider gets its own entry under the Daisu service. The
//! keyring crate transparently uses Windows Credential Manager,
//! macOS Keychain, or libsecret on Linux.

use crate::error::AgentResult;

const SERVICE: &str = "daisu-ide";

fn entry(provider: &str) -> AgentResult<keyring::Entry> {
    keyring::Entry::new(SERVICE, &format!("provider:{provider}")).map_err(Into::into)
}

pub fn set_key(provider: &str, secret: &str) -> AgentResult<()> {
    entry(provider)?.set_password(secret).map_err(Into::into)
}

pub fn get_key(provider: &str) -> AgentResult<Option<String>> {
    match entry(provider)?.get_password() {
        Ok(s) => Ok(Some(s)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

pub fn clear_key(provider: &str) -> AgentResult<()> {
    match entry(provider)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.into()),
    }
}

pub fn has_key(provider: &str) -> AgentResult<bool> {
    Ok(get_key(provider)?.is_some())
}
