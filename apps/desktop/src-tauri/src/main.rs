use tauri::Manager;

mod commands;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .manage(commands::sidecar::RuntimeFacade::default())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            let instance_lock =
                commands::instance_lock::DesktopInstanceLock::acquire(&app_data_dir)?;
            app.manage(instance_lock);
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;
            app.manage(commands::sidecar::RuntimeSidecarManager::new(app.handle().clone()));
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(
                event,
                tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed
            ) {
                if let Some(manager) =
                    window.try_state::<commands::sidecar::RuntimeSidecarManager>()
                {
                    manager.cleanup_streaming_children();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::browser::round_browser_webview,
            commands::sidecar::desktop_build_info,
            commands::sidecar::runtime_sidecar_status,
            commands::sidecar::preview_sidecar_command,
            commands::sidecar::provider_secret_status,
            commands::sidecar::provider_secret_store,
            commands::sidecar::provider_secret_delete,
            commands::sidecar::open_external_url,
            commands::sidecar::read_local_chat_file,
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
