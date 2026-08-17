# Database

PostgreSQL migrations are immutable once applied to a shared environment. Add a new numbered migration instead of editing an applied migration.

All timestamps are stored as UTC-capable `timestamptz`. Document content must never be written to ordinary application logs.

Run migrations with:

```sh
bun run db:migrate
```

The runner acquires a PostgreSQL advisory lock and uses one dedicated connection because migration files contain explicit transactions. Re-running the command must report an empty `executed` list.
