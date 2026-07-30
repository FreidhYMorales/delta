//! Tauri IPC command surface (design D3). Each module exposes plain,
//! directly-testable functions taking `&Session`, plus thin `#[tauri::command]`
//! wrappers that unwrap `tauri::State<'_, Session>` and delegate to them —
//! so integration tests exercise the exact same logic the real IPC transport
//! runs, over a real `Session`, without needing a mocked Tauri app harness.

pub mod doc;
pub mod jff;
pub mod sim;
