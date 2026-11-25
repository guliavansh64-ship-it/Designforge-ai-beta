# Build from the REPO ROOT:  docker build -f apps/api/Dockerfile -t designforge-api .
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN npm ci --workspace packages/shared --workspace apps/api --include-workspace-root
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm --workspace packages/shared run build && npm --workspace apps/api run build \
 && npm prune --omit=dev --workspace packages/shared --workspace apps/api --include-workspace-root

FROM node:20-alpine
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/packages/shared/package.json packages/shared/
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/api/package.json apps/api/
COPY --from=build /app/apps/api/dist apps/api/dist
USER node
EXPOSE 8080
HEALTHCHECK CMD wget -qO- http://127.0.0.1:8080/health || exit 1
CMD ["node", "apps/api/dist/index.js"]
