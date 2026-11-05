//! notecraft Rust 壳（Tauri 2）。
//!
//! 职责：目录选择、文件系统、托盘、自动更新等原生能力（DESIGN-V2 §3.1）。
//! UI 六端共用 client/web，本壳不含业务逻辑。
//!
//! TODO:
//! - 注册 tauri-plugin-fs / tauri-plugin-updater / dialog
//! - 桌面端笔记根目录选择与持久化（注入前端 StorageAdapter）

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        // TODO: .plugin(tauri_plugin_fs::init()) 等
        .run(tauri::generate_context!())
        .expect("error while running notecraft");
}
