use tauri::Manager;

#[tauri::command]
pub fn round_browser_webview(app: tauri::AppHandle, label: String, radius: f64) {
    #[cfg(target_os = "macos")]
    {
        use objc2::rc::Retained;
        use objc2_app_kit::NSView;
        use objc2_quartz_core::CALayer;

        if let Some(webview) = app.get_webview(&label) {
            let _ = webview.with_webview(move |platform_webview| unsafe {
                let view: &NSView = &*platform_webview.inner().cast();
                view.setWantsLayer(true);
                if let Some(layer) = view.layer() {
                    let layer: &CALayer = &*Retained::as_ref(&layer);
                    layer.setCornerRadius(radius);
                    layer.setMasksToBounds(true);
                }
            });
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, label, radius);
    }
}
