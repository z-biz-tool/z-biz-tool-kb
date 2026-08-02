use tauri::Manager;

mod commands;
mod rag;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            commands::upload_document,
            commands::list_documents,
            commands::delete_document,
            commands::ask_question,
            commands::get_llm_config,
            commands::set_llm_config,
        ])
        .setup(|app| {
            // 初始化知识库存储目录
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("无法获取应用数据目录");
            rag::init_storage(&app_data_dir).expect("初始化存储失败");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
