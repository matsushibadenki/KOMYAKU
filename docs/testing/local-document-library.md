# Local Document Library Verification

Native tests cover bounded listing, Canonical-aware rename, revision increment, Archive state, Archive materialization replay, and rollback. JavaScript boundary tests cover metadata validation, exact command names, and copy imports with fresh Document and Node UUIDs.

For packaged QA, create two Documents, switch between them, rename one, fully quit and relaunch, then confirm both bodies remain distinct. Archive and restore one Document. Finally import an Archive whose Document already exists and verify both **Open existing** and **Import as copy** without altering the original.
