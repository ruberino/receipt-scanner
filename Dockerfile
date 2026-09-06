# syntax=docker/dockerfile:1

# npm 12+ is required: npm ci with an older npm still runs node-gyp for
# better-sqlite3 instead of using its bundled prebuild, and fails without
# Python/a compiler. node:22-alpine ships Node 22.23.x, which satisfies
# npm 12's own floor, and better-sqlite3 13 ships a prebuilds/linuxmusl-x64.node
# binary, so nothing is compiled on alpine's musl libc. sharp 0.35 ships the
# same kind of musl prebuild for its own native module.

FROM node:22-alpine AS build
WORKDIR /app
RUN npm install -g npm@12
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM litestream/litestream:0.3.13 AS litestream

FROM node:22-alpine AS runtime
WORKDIR /app
RUN npm install -g npm@12
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
# npm start runs tsx, a regular dependency; sharp needs its native binary.
# Fail the build here instead of failing at container start if either is
# ever missing.
RUN node -e "require('sharp'); require.resolve('tsx')"

COPY src ./src
COPY drizzle ./drizzle
COPY litestream.yml ./litestream.yml
COPY start.sh ./start.sh
RUN chmod +x start.sh
COPY --from=build /app/dist/client ./dist/client
COPY --from=litestream /usr/local/bin/litestream /usr/local/bin/litestream

ENV NODE_ENV=production \
    PORT=8080 \
    TZ=Europe/Oslo \
    DATABASE_PATH=/data/receipt-scanner.db

RUN mkdir -p /data && chown node:node /data

USER node
EXPOSE 8080
CMD ["./start.sh"]
