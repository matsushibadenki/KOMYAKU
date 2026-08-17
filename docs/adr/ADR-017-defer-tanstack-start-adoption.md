# ADR-017: TanStack Start導入の保留

- Status: Accepted
- Date: 2026-08-17
- Decision: 現在のTauri Desktopへは導入しない

## Context

KOMYAKUの現在のRuntime境界は次の通り。

```text
Tauri Desktop
└ React + Vite SPA
   ├ Local SQLite
   └ Hono API Client

Bun Server
└ Hono Modular Monolith
   ├ PostgreSQL
   ├ Object Storage
   └ Outbox / future Workers
```

TanStack StartはTanStack Routerを中心に、SSR、Streaming、Server Functions、Server Routes、Client/Server Buildを提供するFull-stack React Frameworkである。2026-08-17時点の公式DocumentationではRelease Candidate段階とされている。

TauriはStatic Web Hostとして動作し、SPAまたはSSGを前提とする。Server-based SSRはNative Support対象ではない。TanStack StartにはSPA Modeがあるが、Root ShellのPrerender、Build Output、Fallback Rewrite、Tauri APIのClient-only実行をKOMYAKUのmacOS・Windows・Linux・Mobile Targetすべてで検証する必要がある。

## Decision

現時点では`apps/desktop`へTanStack Startを導入しない。Package追加、Vite Plugin変更、Entry Point移行、Generated Route Tree追加も行わない。

理由：

- 現在のDesktopは小さなVite SPAで、StartのSSRやServer Functionsを必要としていない。
- StartのServer Layerと既存Hono APIを併用すると、Authentication、Authorization、Logging、Rate Limit、AI Training Policyの責務が二重化しやすい。
- Tauri Buildは現在の`dist/index.html`を前提として安定している。Start SPA Shellへの変更はDesktop全TargetのPackaging検証なしには安全とみなせない。
- StartはRelease Candidateであり、長期保存を重視するKOMYAKUの基盤依存としてはv1安定化後の評価が適切である。
- 今導入しても、Routing以外のFull-stack機能を使わないためMigration Costに見合う利益が少ない。

## Safe adoption paths

将来は次のどちらかで再評価する。

### A. DesktopはTanStack Routerのみ

複数画面、Nested Route、型安全なSearch Parameterが必要になった段階で、Full-stack Layerを含まない`@tanstack/react-router`だけを評価する。Tauri、Local SQLite、Hono APIの境界は維持する。

### B. Cloud Webを別Applicationとして追加

SSR、公開Document Preview、SEO、Web Loginが必要になった場合は、`apps/web`をTanStack Startで新設する。`apps/desktop`を置換せず、Canonical Schema、API Client、i18n Packageだけを共有する。Server FunctionsからDatabaseへ直接接続せず、権限判断の正本は既存Hono Domain Serviceに保つ。

## Re-evaluation gates

次をすべて満たした時に再評価する。

- TanStack Start v1 Stable
- Tauri向けSPA/Static Buildの再現可能な検証
- macOS、Windows、Linux、iOS、AndroidでDeep LinkとAsset Pathを確認
- CSP、Tauri API、Offline起動、SQLite Migrationの回帰試験
- Honoとの責務分担をArchitecture Testで固定
- Bundle SizeとStartup Timeの比較

## Consequences

現行Vite/Tauri/Hono基盤は変更されず、今回の判断によるRuntime RiskやDependency増加はない。将来のWeb版にTanStack Startを採用する余地は残るが、Desktopへの導入は必要性と検証結果に基づいて決定する。
