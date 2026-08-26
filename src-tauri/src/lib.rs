pub mod commands;
pub mod ipc;
pub mod mealy_ipc;
pub mod moore_ipc;
pub mod pda_ipc;
pub mod state;
pub mod tabs;
pub mod tm_ipc;

use commands::{convert, doc, jff, mealy, moore, pda, project, sim, tm};
use commands::project::ProjectState;
use state::{MealySession, MooreSession, PdaSession, Session, TmSession};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .manage(Session::new())
    .manage(MealySession::new())
    .manage(MooreSession::new())
    .manage(PdaSession::new())
    .manage(TmSession::new())
    .manage(ProjectState::new())
    .invoke_handler(tauri::generate_handler![
      doc::doc_snapshot,
      doc::doc_apply,
      doc::doc_undo,
      doc::doc_redo,
      doc::doc_open,
      doc::doc_save,
      sim::sim_trace,
      sim::sim_batch,
      jff::jff_import,
      jff::jff_export,
      convert::conv_to_regex,
      convert::conv_from_regex,
      convert::conv_to_grammar,
      convert::conv_from_grammar,
      convert::conv_nfa_to_dfa,
      convert::conv_minimize_dfa,
      mealy::mealy_snapshot,
      mealy::mealy_apply,
      mealy::mealy_undo,
      mealy::mealy_redo,
      mealy::mealy_open,
      mealy::mealy_save,
      mealy::mealy_sim,
      moore::moore_snapshot,
      moore::moore_apply,
      moore::moore_undo,
      moore::moore_redo,
      moore::moore_open,
      moore::moore_save,
      moore::moore_sim,
      pda::pda_snapshot,
      pda::pda_apply,
      pda::pda_undo,
      pda::pda_redo,
      pda::pda_open,
      pda::pda_save,
      pda::pda_sim,
      tm::tm_snapshot,
      tm::tm_apply,
      tm::tm_undo,
      tm::tm_redo,
      tm::tm_open,
      tm::tm_save,
      tm::tm_sim,
      project::project_new,
      project::project_manifest,
      project::project_new_tab,
      project::project_close_tab,
      project::project_rename_tab,
      project::project_open,
      project::project_save,
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
