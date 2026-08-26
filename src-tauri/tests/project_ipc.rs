//! `project_new` / `project_manifest` / `project_new_tab` / `project_close_tab`
//! / `project_rename_tab` / `project_open` / `project_save` (PR3 of the
//! `multi-tab-projects` change) — same "call the pure fn directly over real
//! sessions" shape as every other `*_ipc.rs` integration test in this crate.

use std::sync::Mutex;

use app_lib::commands::project::{self, Sessions};
use app_lib::state::{MealySession, MooreSession, PdaSession, Session, TmSession};
use app_lib::tabs::{MachineKind, ProjectSession, TabId};
use automata_core::doc::EditOp;

struct Fixture {
    project: Mutex<ProjectSession>,
    fa: Session,
    mealy: MealySession,
    moore: MooreSession,
    pda: PdaSession,
    tm: TmSession,
}

impl Fixture {
    fn new() -> Self {
        Fixture {
            project: Mutex::new(ProjectSession::new()),
            fa: Session::new(),
            mealy: MealySession::new(),
            moore: MooreSession::new(),
            pda: PdaSession::new(),
            tm: TmSession::new(),
        }
    }

    fn sessions(&self) -> Sessions<'_> {
        Sessions { fa: &self.fa, mealy: &self.mealy, moore: &self.moore, pda: &self.pda, tm: &self.tm }
    }
}

#[test]
fn new_tab_with_valid_kind_and_name_appears_in_the_manifest() {
    let fx = Fixture::new();
    let manifest = project::new_tab(&fx.project, &fx.sessions(), MachineKind::Fa, "My FA".into()).unwrap();

    assert_eq!(manifest.tabs.len(), 1);
    assert_eq!(manifest.tabs[0].kind, MachineKind::Fa);
    assert_eq!(manifest.tabs[0].name, "My FA");

    let refreshed = project::manifest(&fx.project, &fx.sessions());
    assert_eq!(refreshed.tabs.len(), 1);
    assert_eq!(refreshed.tabs[0].id, manifest.tabs[0].id);
}

#[test]
fn new_tab_with_an_empty_name_is_rejected() {
    let fx = Fixture::new();
    let err = project::new_tab(&fx.project, &fx.sessions(), MachineKind::Fa, "   ".into());
    assert!(err.is_err());
    assert!(project::manifest(&fx.project, &fx.sessions()).tabs.is_empty());
}

#[test]
fn new_tab_with_a_duplicate_name_is_rejected() {
    let fx = Fixture::new();
    project::new_tab(&fx.project, &fx.sessions(), MachineKind::Fa, "Same".into()).unwrap();

    let err = project::new_tab(&fx.project, &fx.sessions(), MachineKind::Tm, "Same".into());
    assert!(err.is_err());
    assert_eq!(project::manifest(&fx.project, &fx.sessions()).tabs.len(), 1);
}

#[test]
fn rename_tab_rejects_empty_and_duplicate_names_but_allows_a_genuinely_new_one() {
    let fx = Fixture::new();
    let a = project::new_tab(&fx.project, &fx.sessions(), MachineKind::Fa, "A".into()).unwrap().tabs[0].id;
    project::new_tab(&fx.project, &fx.sessions(), MachineKind::Mealy, "B".into()).unwrap();

    assert!(project::rename_tab(&fx.project, &fx.sessions(), a, "".into()).is_err());
    assert!(project::rename_tab(&fx.project, &fx.sessions(), a, "B".into()).is_err());

    let manifest = project::rename_tab(&fx.project, &fx.sessions(), a, "Renamed".into()).unwrap();
    let renamed = manifest.tabs.iter().find(|t| t.id == a).unwrap();
    assert_eq!(renamed.name, "Renamed");
}

#[test]
fn rename_tab_on_an_unknown_id_is_rejected() {
    let fx = Fixture::new();
    let err = project::rename_tab(&fx.project, &fx.sessions(), TabId(999), "Whatever".into());
    assert!(err.is_err());
}

#[test]
fn close_tab_removes_it_and_a_second_close_of_the_same_id_fails() {
    let fx = Fixture::new();
    let a = project::new_tab(&fx.project, &fx.sessions(), MachineKind::Fa, "A".into()).unwrap().tabs[0].id;

    let manifest = project::close_tab(&fx.project, &fx.sessions(), a).unwrap();
    assert!(manifest.tabs.is_empty());

    let err = project::close_tab(&fx.project, &fx.sessions(), a);
    assert!(err.is_err());
}

#[test]
fn save_then_open_round_trips_a_multi_tab_mixed_kind_project() {
    let fx = Fixture::new();
    let fa_id = project::new_tab(&fx.project, &fx.sessions(), MachineKind::Fa, "The FA".into()).unwrap().tabs[0].id;
    let tm_id = project::new_tab(&fx.project, &fx.sessions(), MachineKind::Tm, "The TM".into()).unwrap().tabs[0].id;

    fx.fa.with_mut(fa_id, |doc| {
        doc.apply(vec![EditOp::AddState { label: "q0".into(), x: 1.0, y: 2.0 }]);
    });

    let dir = std::env::temp_dir();
    let path = dir.join(format!("multi_tab_project_{}.json", std::process::id()));
    let path_str = path.to_str().unwrap().to_string();

    project::save_project(&fx.project, &fx.sessions(), path_str.clone()).unwrap();

    // Clear the project, then reload it from disk.
    project::new_project(&fx.project, &fx.sessions());
    assert!(project::manifest(&fx.project, &fx.sessions()).tabs.is_empty());

    let reopened = project::open_project(&fx.project, &fx.sessions(), path_str).unwrap();
    assert_eq!(reopened.tabs.len(), 2);

    let names: Vec<&str> = reopened.tabs.iter().map(|t| t.name.as_str()).collect();
    assert_eq!(names, vec!["The FA", "The TM"]);

    let reopened_fa = reopened.tabs.iter().find(|t| t.kind == MachineKind::Fa).unwrap();
    let has_state = fx.fa.with(reopened_fa.id, |doc| doc.model.states().count() == 1);
    assert!(has_state);

    let reopened_tm = reopened.tabs.iter().find(|t| t.kind == MachineKind::Tm).unwrap();
    let tm_state_count = fx.tm.with(reopened_tm.id, |doc| doc.model.states().count());
    assert_eq!(tm_state_count, 0);

    let _ = std::fs::remove_file(&path);
}

#[test]
fn open_on_a_nonexistent_path_fails_without_panicking() {
    let fx = Fixture::new();
    let err = project::open_project(&fx.project, &fx.sessions(), "/nonexistent/path/does-not-exist.json".into());
    assert!(err.is_err());
}

#[test]
fn open_on_a_malformed_file_fails_without_panicking() {
    let fx = Fixture::new();
    let dir = std::env::temp_dir();
    let path = dir.join(format!("malformed_project_{}.json", std::process::id()));
    std::fs::write(&path, "not json at all").unwrap();

    let err = project::open_project(&fx.project, &fx.sessions(), path.to_str().unwrap().to_string());
    assert!(err.is_err());

    let _ = std::fs::remove_file(&path);
}
