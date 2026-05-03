//! Workspace walker that respects `.gitignore` + standard hidden filters,
//! then layers user include/exclude globs on top.

use std::path::Path;

use ignore::overrides::OverrideBuilder;
use ignore::{Walk, WalkBuilder};

use crate::error::{AppError, AppResult};

use super::SearchOptions;

/// Build an ignore-aware walker for `root` honoring user globs.
///
/// `standard_filters(true)` activates `.gitignore` + `.ignore` + hidden file
/// filtering. User include globs are added as positive entries; exclude globs
/// are added as negative entries (`!pattern`).
///
/// # Errors
/// Returns [`AppError::Internal`] if a glob pattern is invalid or override
/// build fails.
pub fn build_walker(root: &Path, opts: &SearchOptions) -> AppResult<Walk> {
    let mut wb = WalkBuilder::new(root);
    wb.standard_filters(true)
        .require_git(false)
        .follow_links(false);

    if !opts.include_globs.is_empty() || !opts.exclude_globs.is_empty() {
        let mut overrides = OverrideBuilder::new(root);
        for inc in &opts.include_globs {
            overrides
                .add(inc)
                .map_err(|e| AppError::Internal(format!("include glob {inc}: {e}")))?;
        }
        for exc in &opts.exclude_globs {
            let pattern = format!("!{exc}");
            overrides
                .add(&pattern)
                .map_err(|e| AppError::Internal(format!("exclude glob {exc}: {e}")))?;
        }
        let built = overrides
            .build()
            .map_err(|e| AppError::Internal(format!("build overrides: {e}")))?;
        wb.overrides(built);
    }

    Ok(wb.build())
}
