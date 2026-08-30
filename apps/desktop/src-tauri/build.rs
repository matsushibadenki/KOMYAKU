fn main() {
    const APP_COMMANDS: &[&str] = &[
        "save_local_draft_atomic",
        "store_cloud_session",
        "load_cloud_session",
        "delete_cloud_session",
        "store_provider_credential",
        "load_provider_credential",
        "delete_provider_credential",
        "save_local_ai_handoff_atomic",
        "load_local_conversation",
        "list_local_conversations",
    ];

    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(APP_COMMANDS)),
    )
    .expect("failed to build KOMYAKU Tauri context")
}
