//! 桌面端二进制入口：实现在 lib.rs（移动端以库形式链接同一实现）。

// 发布版不弹控制台窗口（Windows）
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    notecraft_lib::run()
}
