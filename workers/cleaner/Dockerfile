FROM node:22-alpine AS builder
RUN npm install -g pnpm@9.15.9
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile=false
RUN pnpm --filter @agentic-news/shared build \
 && pnpm --filter @agentic-news/storage build \
 && pnpm --filter @agentic-news/cleaner build

FROM node:22-alpine
RUN npm install -g pnpm@9.15.9
WORKDIR /repo
COPY --from=builder /repo /repo
CMD ["node", "workers/cleaner/dist/main.js"]
