FROM node:26-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./

# Dev: o código entra por volume; o comando vem do compose (migrate, api ou worker).
FROM base AS dev
RUN npm ci

FROM base AS builder
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# Uma imagem, três comandos: dist/migrate.js, dist/api/main.js, dist/worker/main.js.
FROM node:26-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
# O runner de migration lê estes arquivos em runtime; sem eles o migrate falha.
COPY migrations ./migrations
USER node
EXPOSE 3001
