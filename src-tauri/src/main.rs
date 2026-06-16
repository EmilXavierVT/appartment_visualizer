use tauri::{WebviewUrl, WebviewWindowBuilder};

const APP_URL: &str = "https://hinkesten.project-ice.dk/";

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let url = APP_URL.parse().expect("valid app URL");

            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .title("Apartment Visualizer")
                .inner_size(1280.0, 900.0)
                .min_inner_size(390.0, 700.0)
                .resizable(true)
                .build()?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Apartment Visualizer desktop app");
}
