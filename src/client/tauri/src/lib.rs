//! notecraft Rust 壳（Tauri 2）。
//!
//! 职责：目录选择、文件系统、托盘、自动更新等原生能力（DESIGN.md §3.1）。
//! UI 六端共用 client/web，本壳不含业务逻辑。
//!
//! 已注册：fs（沙箱内读写笔记目录，scope 见 capabilities/）、dialog（目录选择）。
//! TODO（M6/未决项）：
//! - tauri-plugin-updater 自动更新（需签名密钥，随首个发布补齐）
//! - 托盘图标；桌面端目录变更监听（watch）接入前端 StorageAdapter
//!
//! 结构：lib.rs 为唯一实现（Android/iOS 以 cdylib 链接），桌面二进制入口 main.rs 调用 run()。

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .run(tauri::generate_context!())
        .expect("error while running notecraft");
}
