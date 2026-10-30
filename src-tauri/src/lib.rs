use tauri::Manager;

mod commands;
pub mod rag;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 深链队列：既要 manage 给命令用，又要传给冷启动 seed —— 两处必须同一份。
    let zbiz_pending = cap_hub::receiver::SharedPending::default();

    tauri::Builder::default()
        // 单实例（2026-10-26 分发底座）：第二次启动聚焦已有窗口，不再开新进程。
        // 必须作为第一个注册的插件（tauri-plugin-single-instance 官方要求）。
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
            cap_hub::receiver::handle_second_instance(app, &argv);
        }))
        .manage(zbiz_pending.clone())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        // 自动更新：前端 UpdaterGate 延时 check()，endpoint/pubkey 见 tauri.conf.json
        .plugin(tauri_plugin_updater::Builder::new().build())
        // 更新安装完成后的「立即重启」
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            commands::upload_document,
            commands::list_documents,
            commands::get_document_detail,
            commands::delete_document,
            commands::ask_question,
            commands::get_llm_config,
            commands::set_llm_config,
            zbiz_take_pending,
        ])
        .setup(move |app| {
            // 冷启动时 argv 里就可能带着深链；先入队，前端 mount 后再取。
            cap_hub::receiver::seed_cold_start(app.handle(), &zbiz_pending);
            // 初始化知识库存储目录
            let app_data_dir = app.path().app_data_dir().expect("无法获取应用数据目录");
            rag::init_storage(&app_data_dir).expect("初始化存储失败");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// 取走队列里的深链（家族统一命令名）。
#[tauri::command]
fn zbiz_take_pending(
    pending: tauri::State<'_, cap_hub::receiver::SharedPending>,
) -> Vec<cap_hub::Handoff> {
    cap_hub::receiver::take_pending_from(pending.inner())
}
