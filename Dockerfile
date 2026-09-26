# ---------- build stage ----------
FROM node:22-alpine AS build
WORKDIR /app

# Install dependencies first for better layer caching.
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --omit=optional --no-audit --no-fund

# Build the client bundle and the server bundle.
COPY shared ./shared
COPY server ./server
COPY client ./client
RUN npm run build

# ---------- runtime stage ----------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# The server bundle is self-contained (Node's built-in SQLite is used).
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/client/dist ./client/dist

RUN mkdir -p /app/data && chown -R node:node /app
USER node

EXPOSE 3001
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/dist/server.mjs"]
