//! Multi-tab project persistence. A project envelope is
//! `{"version": 1, "tabs": [{"name": ..., "model": {"kind": "Fa", ...}}, ...]}`
//! — an ordered list of `ProjectTab`s, each wrapping the existing,
//! untouched `MachineDoc` boundary enum (`dto.rs`) so every machine kind
//! `MachineDoc` already supports is automatically a valid tab model.
//!
//! This is a sibling envelope to `dto.rs`'s single-document `Envelope`, not
//! a replacement for it — legacy single-document files keep loading via
//! `dto.rs`'s own per-kind loaders and the new `any_load_from_str` (used by
//! a later PR to detect and migrate a legacy file into a one-tab project).

use serde::{Deserialize, Serialize};

use crate::dto::MachineDoc;

pub const CURRENT_PROJECT_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ProjectTab {
    pub name: String,
    pub model: MachineDoc,
}

#[derive(Debug, Serialize, Deserialize)]
struct ProjectEnvelope {
    version: u32,
    tabs: Vec<ProjectTab>,
}

#[derive(Debug, thiserror::Error)]
pub enum ProjectError {
    #[error("unsupported project version {0} (expected {CURRENT_PROJECT_VERSION})")]
    UnsupportedVersion(u32),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

pub fn project_save_to_string(tabs: &[ProjectTab]) -> Result<String, ProjectError> {
    let envelope = ProjectEnvelope { version: CURRENT_PROJECT_VERSION, tabs: tabs.to_vec() };
    Ok(serde_json::to_string_pretty(&envelope)?)
}

pub fn project_load_from_str(s: &str) -> Result<Vec<ProjectTab>, ProjectError> {
    let envelope: ProjectEnvelope = serde_json::from_str(s)?;
    if envelope.version != CURRENT_PROJECT_VERSION {
        return Err(ProjectError::UnsupportedVersion(envelope.version));
    }
    Ok(envelope.tabs)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dto::{FaDto, TmDto};

    fn fa_tab(name: &str) -> ProjectTab {
        ProjectTab {
            name: name.to_string(),
            model: MachineDoc::Fa(FaDto { states: vec![], edges: vec![], initial: None }),
        }
    }

    fn tm_tab(name: &str) -> ProjectTab {
        ProjectTab {
            name: name.to_string(),
            model: MachineDoc::Tm(TmDto { states: vec![], transitions: vec![], initial: None, tape_count: 0 }),
        }
    }

    #[test]
    fn round_trip_preserves_mixed_kind_tabs_and_order() {
        let tabs = vec![fa_tab("first"), tm_tab("second")];
        let json = project_save_to_string(&tabs).unwrap();
        let reloaded = project_load_from_str(&json).unwrap();
        assert_eq!(reloaded, tabs);
    }

    #[test]
    fn unsupported_version_fails_with_a_clear_error() {
        let json = r#"{"version":2,"tabs":[]}"#;
        let err = project_load_from_str(json).unwrap_err();
        assert!(matches!(err, ProjectError::UnsupportedVersion(2)));
    }

    #[test]
    fn malformed_json_fails_without_panicking() {
        assert!(project_load_from_str("not json at all").is_err());
        assert!(project_load_from_str(r#"{"version":1,"tabs":["#).is_err());
        assert!(project_load_from_str(r#"{"version":1}"#).is_err());
    }
}
