# ADR-037: Bun 1.4.0 Toolchain and Container Pin

- Status: Accepted and implemented
- Date: 2026-08-24
- Owners: KOMYAKU architecture

## Context

KOMYAKU previously declared Bun 1.3.11 only through the root `packageManager` field. It had no checked-in Bun application image, so local and Linux server builds could silently use different Bun releases.

## Decision

- Set the root `packageManager` and `engines.bun` fields to the exact version `1.4.0`.
- Use the official exact image `oven/bun:1.4.0` for both build and runtime stages of the Linux Cloud Server image.
- Install dependencies with `bun install --frozen-lockfile`, then run the unit suite and workspace build inside the build image.
- Copy only the bundled server artifact into the unprivileged runtime stage and run it as the image's `bun` user.
- Keep the Tauri desktop build on its platform-native Rust toolchain; the Bun container is the reproducible JavaScript/server boundary, not a replacement for native Tauri packaging.
- Do not use floating `latest` or major-only Bun tags. A Bun upgrade must update package metadata and both Docker stages together, then verify the lockfile and run the full test/build suite in the target image.

## Consequences

- Local tooling reports one required Bun release instead of accepting an open-ended 1.x range.
- Server build and runtime use the same Bun release, reducing environment drift.
- Image security and Bun patch upgrades remain explicit maintenance work rather than silent changes.
- Production configuration and credentials remain runtime inputs and are never copied into the image.

## Verification

```text
docker build --pull -t komyaku-server:bun-1.4.0 .
docker run --rm komyaku-server:bun-1.4.0 bun --version
```

## Multilingual summary

- 日本語: Workspace、Server Build、Server RuntimeをBun 1.4.0へ固定し、可変Tagによる予期しない更新を避ける。
- English: Pin the workspace, server build, and server runtime to Bun 1.4.0 and avoid unreviewed changes from floating tags.
- 简体中文：将Workspace、服务器构建和服务器运行环境固定为Bun 1.4.0，避免浮动标签带来的未经审核更新。
