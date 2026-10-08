# N1 block verification — 2026-10-08

[Done] N1 implementation items and the combined automated exit scenario are complete. The new `n1_history_block_recovers_branches_restore_and_exact_assets` test calls production SQLite functions against a disposable file database; no network or user profile is used.

The scenario validates a normalized Canonical PNG document, saves A and B on the main Branch, creates C from A on an alternative Branch, and restores A as a new child of B. After closing every connection and reopening the database, it checks all four Versions and ordered parents, both Branch heads, exact Snapshot strings and SHA-256 values, each Version’s hash-verified PNG bytes, and the restored draft at revision 2. It then replays the restore without creating another Version and rejects a stale main-Branch update without losing the alternative.

[Done] Full Rust suite: 55 passed, 0 failed, 1 explicit performance fixture ignored. Full Bun suite: 504 passed, 0 failed, 25 PostgreSQL-dependent tests skipped. Existing export tests cover the public account-free v1 writer/reader and download preparation; the new native scenario supplies recovered Snapshot/Asset evidence, not a new packaged download pass.

[Done] Earlier packaged evidence remains separately scoped in [history QA](history-packaged-restart-recovery.md), [editing QA](editing-packaged-restart-recovery.md), and [downloaded export files](export-packaged-files.md). These reports establish only their recorded scenarios.

[Next] N0 still needs deterministic packaged pending-autosave navigation/import and dirty export, plus failed-persistence library-open/import/restore controls. N1 closure does not complete N0, N2 usability or N3 full-history portability.

[Pending] Real IME conversion is on hold until conversion can be started in the QA environment; actual-user pilots and Windows/Linux release checks require users/hosts absent from this development environment. No forced-kill, power-loss or full-disk claim is made by the SQLite connection-reopen test.
