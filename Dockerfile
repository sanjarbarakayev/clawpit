# Multi-stage build keeps the runtime image small. We don't ship pnpm or
# devDependencies into the final image because clawpit runs through tsx,
# which is itself a runtime dependency.

FROM node:24-slim AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.9.0 --activate
COPY package.json pnpm-lock.yaml ./
# `pnpm install --prod=false` because tsx is in devDependencies but is the
# runtime executor — without it `pnpm serve` cannot start. We accept the
# slightly larger image in exchange for not having a build step.
RUN pnpm install --frozen-lockfile

FROM node:24-slim AS runtime
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.9.0 --activate

# Non-root user for runtime — small but free hardening win.
RUN groupadd -g 1001 clawpit && useradd -u 1001 -g clawpit -m clawpit

COPY --from=deps --chown=clawpit:clawpit /app/node_modules ./node_modules
COPY --chown=clawpit:clawpit package.json pnpm-lock.yaml tsconfig.json ./
COPY --chown=clawpit:clawpit src ./src
COPY --chown=clawpit:clawpit web ./web
COPY --chown=clawpit:clawpit data ./data
# Tournament 2 snapshot (T1+T2 combined, 45 matches) doubles as the seed
# dataset on first boot — see the "seed-on-empty" branch in
# src/cli/index.ts cmdServe.
COPY --chown=clawpit:clawpit docs/tournament-2-data ./seed

USER clawpit

ENV NODE_ENV=production
# Note: we deliberately do NOT set CLAWPIT_PORT here. PaaS providers
# (Render/Fly/Railway) inject $PORT dynamically; if CLAWPIT_PORT were
# baked in it would shadow $PORT and the container would bind the
# wrong port. The server falls back to 8080 in code when neither is set.
ENV CLAWPIT_SEED_DIR=/app/seed
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["pnpm", "serve"]
