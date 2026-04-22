mod commands;

fn main() {
    tauri::Builder::default()
        .manage(commands::sidecar::RuntimeFacade::default())
        .invoke_handler(tauri::generate_handler![
            commands::sidecar::runtime_sidecar_status,
            commands::sidecar::preview_sidecar_command,
            commands::sidecar::runtime_json_rpc,
            commands::sidecar::runtime_start_run,
            commands::sidecar::runtime_stream_run,
            commands::sidecar::runtime_list_runs,
            commands::sidecar::runtime_fork_run,
            commands::sidecar::runtime_resume_run,
            commands::sidecar::runtime_cancel_run,
            commands::sidecar::runtime_export_report,
            commands::sidecar::runtime_run_status
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Ora desktop shell");
}
