pub mod commands;
pub mod ipc;
pub mod state;

use commands::{convert, doc, jff, sim};
use state::Session;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .manage(Session::new())
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
