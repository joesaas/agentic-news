FROM node:22-alpine AS builder
RUN npm install -g pnpm@9.15.9
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile=false
RUN pnpm --filter @agentic-news/shared build \
 && pnpm --filter @agentic-news/storage build \
 && pnpm --filter @agentic-news/api build

FROM node:22-alpine
RUN npm install -g pnpm@9.15.9
WORKDIR /repo
COPY --from=builder /repo /repo
EXPOSE 3001
CMD ["node", "apps/api/dist/main.js"]
