FROM oven/bun:1.4.0 AS dependencies

WORKDIR /app

COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/package.json
COPY apps/desktop/package.json apps/desktop/package.json
COPY packages/ai-gateway/package.json packages/ai-gateway/package.json
COPY packages/api-client/package.json packages/api-client/package.json
COPY packages/conversation-importer/package.json packages/conversation-importer/package.json
COPY packages/conversation-schema/package.json packages/conversation-schema/package.json
COPY packages/diff-engine/package.json packages/diff-engine/package.json
COPY packages/document-schema/package.json packages/document-schema/package.json
COPY packages/editor-core/package.json packages/editor-core/package.json
COPY packages/entitlements/package.json packages/entitlements/package.json
COPY packages/i18n/package.json packages/i18n/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/storage-core/package.json packages/storage-core/package.json
COPY packages/sync-core/package.json packages/sync-core/package.json
COPY packages/version-engine/package.json packages/version-engine/package.json

RUN bun install --frozen-lockfile

FROM dependencies AS verified-build

COPY apps apps
COPY packages packages
COPY tokens.css tokens.css

RUN bun test
RUN bun run build

FROM oven/bun:1.4.0 AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY --from=verified-build --chown=bun:bun /app/apps/server/dist/index.js ./index.js

USER bun
EXPOSE 3000

CMD ["bun", "index.js"]
