# Jarvis: the app and its backend as one service.
#   docker build -t jarvis .
#   docker run -p 8080:8080 -v jarvis-data:/data --env-file .env jarvis
# Everything is stored in /data (put a volume there). See README.md, "Go live".

# 1. Build the app, set to talk to the server it is served from.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ENV VITE_JARVIS_API_URL=same-origin
RUN npm run build

# 2. Run the server. It has no npm dependencies: Node 22's built-in http, sqlite and crypto.
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=8080
WORKDIR /app
COPY package.json ./
COPY --from=build /app/dist ./dist
COPY server ./server
# The sample data for `npm run seed` comes from the app's demo data.
COPY src ./src
COPY server/docker-entrypoint.sh /usr/local/bin/jarvis-entrypoint
# Strip Windows line endings in case the repo was checked out on Windows.
RUN sed -i 's/\r$//' /usr/local/bin/jarvis-entrypoint && chmod +x /usr/local/bin/jarvis-entrypoint \
  && mkdir -p /data && chown node:node /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["jarvis-entrypoint"]
CMD ["node", "--disable-warning=ExperimentalWarning", "server/src/main.ts"]
