// Included in lib.rs's test module to exercise production N1 transactions together.
#[tokio::test]
async fn n1_history_block_recovers_branches_restore_and_exact_assets() {
    let path = std::env::temp_dir().join(format!(
        "komyaku-n1-{}.db",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let url = format!("sqlite://{}?mode=rwc", path.display());
    let db = SqlitePoolOptions::new()
        .max_connections(1)
        .connect(&url)
        .await
        .unwrap();
    migrate_test_pool(&db).await;
    let asset_id = "00000000-0000-4000-8000-000000000801";
    let preview = local_png_preview_input(asset_id);
    store_local_png_preview_transaction(&db, &preview)
        .await
        .unwrap();
    let mut draft = draft_with_image(1, asset_id);
    let mut document: serde_json::Value = serde_json::from_str(&draft.content_json).unwrap();
    document["schemaId"] = serde_json::json!("https://komyaku.example/schemas/document/v1");
    document["type"] = serde_json::json!("document");
    document["extensions"] = serde_json::json!({});
    let image = &mut document["content"][0];
    image["id"] = serde_json::json!("00000000-0000-4000-8000-000000000802");
    image["schemaVersion"] = serde_json::json!(1);
    image["metadata"] = serde_json::json!({});
    image["extensions"] = serde_json::json!({});
    image["renderArtifacts"] = serde_json::json!([]);
    image["caption"] = serde_json::json!([]);
    image["width"] = serde_json::Value::Null;
    image["height"] = serde_json::Value::Null;
    story_document_validation::validate_document_subset(&document).unwrap();
    draft.content_json = document.to_string();
    save_local_draft_transaction(&db, &draft).await.unwrap();
    let a = "00000000-0000-4000-8000-000000000810";
    let b = "00000000-0000-4000-8000-000000000811";
    let c = "00000000-0000-4000-8000-000000000812";
    let restored = "00000000-0000-4000-8000-000000000813";
    let mut first = local_version_input(
        "00000000-0000-4000-8000-000000000820",
        a,
        vec![],
        None,
        "initial",
    );
    first.version.snapshot_json = draft.content_json.clone();
    first.version.snapshot_hash = Sha256::digest(first.version.snapshot_json.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    save_local_version_transaction(&db, &first).await.unwrap();
    let mut second = local_version_input(
        "00000000-0000-4000-8000-000000000821",
        b,
        vec![a.into()],
        Some(a.into()),
        "named",
    );
    document["content"][0]["altText"] = serde_json::json!("B 日本語 English 简体中文");
    second.version.snapshot_json = document.to_string();
    second.version.snapshot_hash = Sha256::digest(second.version.snapshot_json.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    save_local_version_transaction(&db, &second).await.unwrap();
    let mut alternative = local_version_input(
        "00000000-0000-4000-8000-000000000822",
        c,
        vec![a.into()],
        Some(a.into()),
        "named",
    );
    alternative.branch_id = "00000000-0000-4000-8000-000000000830".into();
    alternative.branch_name = "別案 Alternative 备选".into();
    document["content"][0]["altText"] = serde_json::json!("C 別案");
    alternative.version.snapshot_json = document.to_string();
    alternative.version.snapshot_hash =
        Sha256::digest(alternative.version.snapshot_json.as_bytes())
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect();
    save_local_version_transaction(&db, &alternative)
        .await
        .unwrap();
    let mut restore = local_version_input(
        "00000000-0000-4000-8000-000000000823",
        restored,
        vec![b.into()],
        Some(b.into()),
        "restore",
    );
    restore.version.snapshot_json = first.version.snapshot_json.clone();
    restore.version.snapshot_hash = first.version.snapshot_hash.clone();
    restore.version.restored_from_version_id = Some(a.into());
    restore.restore_draft_revision = Some(2);
    assert!(
        !save_local_version_transaction(&db, &restore)
            .await
            .unwrap()
            .replayed
    );
    db.close().await;
    let reopened = SqlitePoolOptions::new()
        .max_connections(1)
        .connect(&url)
        .await
        .unwrap();
    let history = list_local_version_history_transaction(&reopened, &draft.document_id, None, None)
        .await
        .unwrap();
    assert_eq!(history.versions.len(), 4);
    assert_eq!(history.branches.len(), 2);
    assert_eq!(history.current_version_id.as_deref(), Some(restored));
    for request in [&first, &second, &alternative, &restore] {
        let version = history
            .versions
            .iter()
            .find(|v| v.id == request.version.id)
            .unwrap();
        assert_eq!(version.parent_ids, request.version.parent_ids);
        let snapshot = load_local_version_snapshot_transaction(
            &reopened,
            &draft.document_id,
            &request.version.id,
        )
        .await
        .unwrap();
        assert_eq!(snapshot.snapshot_json, request.version.snapshot_json);
        assert_eq!(snapshot.snapshot_hash, request.version.snapshot_hash);
        let assets = load_local_version_assets_transaction(
            &reopened,
            &draft.document_id,
            &request.version.id,
        )
        .await
        .unwrap();
        assert_eq!(assets.len(), 1);
        assert_eq!(assets[0].bytes, preview.bytes);
    }
    assert_eq!(
        history
            .branches
            .iter()
            .find(|v| v.id == first.branch_id)
            .unwrap()
            .head_version_id,
        restored
    );
    assert_eq!(
        history
            .branches
            .iter()
            .find(|v| v.id == alternative.branch_id)
            .unwrap()
            .head_version_id,
        c
    );
    let recovered: (String, i64) =
        sqlx::query_as("SELECT content_json, local_revision FROM local_drafts WHERE document_id=?")
            .bind(&draft.document_id)
            .fetch_one(&reopened)
            .await
            .unwrap();
    assert_eq!(recovered, (first.version.snapshot_json.clone(), 2));
    assert!(
        save_local_version_transaction(&reopened, &restore)
            .await
            .unwrap()
            .replayed
    );
    let mut stale: SaveLocalVersionInput =
        serde_json::from_value(serde_json::to_value(&second).unwrap()).unwrap();
    stale.operation_id = "00000000-0000-4000-8000-000000000824".into();
    stale.version.id = "00000000-0000-4000-8000-000000000814".into();
    assert_eq!(
        save_local_version_transaction(&reopened, &stale).await,
        Err("stale_local_branch_head")
    );
    assert_eq!(
        list_local_version_history_transaction(&reopened, &draft.document_id, None, None)
            .await
            .unwrap()
            .versions
            .len(),
        4
    );
    reopened.close().await;
    std::fs::remove_file(path).unwrap();
}
