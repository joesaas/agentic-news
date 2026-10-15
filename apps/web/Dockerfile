FROM node:22-alpine AS builder
RUN npm install -g pnpm@9.15.9
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile=false
ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN pnpm --filter @agentic-news/web build

FROM node:22-alpine
RUN npm install -g pnpm@9.15.9
WORKDIR /repo
COPY --from=builder /repo /repo
EXPOSE 3000
CMD ["pnpm", "--filter", "@agentic-news/web", "start"]
