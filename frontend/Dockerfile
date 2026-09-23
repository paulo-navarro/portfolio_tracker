FROM node:26-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./

FROM base AS dev
RUN npm ci
CMD ["npx", "vite"]

FROM base AS builder
RUN npm ci
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
COPY public ./public
# Vem do additional_contexts `keys` do compose. A de prod, nunca a de dev.
COPY --from=keys sealing.prod.pub /keys/sealing.pub
ENV SEALING_PUBLIC_KEY_FILE=/keys/sealing.pub
RUN npm run build

FROM nginx:1.31-alpine AS prod
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY security-headers.conf /etc/nginx/snippets/security-headers.conf
EXPOSE 80
