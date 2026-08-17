# KOMYAKU / 稿脈

KOMYAKU is a multilingual, local-first platform for preserving how documents evolve through immutable versions and alternative branches.

## Requirements

- Bun 1.3 or later
- Rust 1.93 or later for Tauri
- Docker for local PostgreSQL and object storage

## Quick start

```sh
cp .env.example .env
bun install
docker compose up -d
bun run db:migrate
bun run storage:init
bun run dev:server
bun run dev
```

See `docs/guides/development-setup.md` for details.
