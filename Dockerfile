# One container: the Express server, serving the built React app.

FROM node:26-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# No package's install scripts run (as in .npmrc, which isn't copied in): none needs one.
RUN npm ci --ignore-scripts
COPY vite.config.js ./
COPY web ./web
RUN npm run build

FROM node:26-slim
# UV_THREADPOOL_SIZE: the threads Node reads files with (4 unless set). The
# films may take half of them at most (server/routes/media.js), so a network
# share that stops answering leaves the other half for the pages and scripts.
ENV NODE_ENV=production \
    UV_THREADPOOL_SIZE=32 \
    PORT=3000 \
    DATA_DIR=/data \
    MEDIA_DIR=/media \
    WEB_DIST=/app/dist
WORKDIR /app
COPY package.json package-lock.json ./
# The image only ever runs node, so the package managers go once npm has
# installed the packages: npm itself, and the yarn and corepack that come with
# the base image.
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
           /usr/local/lib/node_modules/corepack /usr/local/bin/corepack \
           /opt/yarn-v* /usr/local/bin/yarn /usr/local/bin/yarnpkg
COPY server ./server
COPY --from=build /app/dist ./dist
RUN mkdir -p /data /media && chown node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:3000/api/site').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "server/index.js"]
