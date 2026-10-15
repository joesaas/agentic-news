# agentic-news

一个支持个性化的多租户资讯平台：用户给定主题，系统定时收集相关的事件、Blog 与动态，再按每个人的身份和口味排序展示 —— 千人千面。

## prototype/ —— 产品原型

`prototype/index.html` 是当前的产品原型，**单文件**、无后端、无真实数据、无实际业务逻辑，所有资讯条目均为示例占位。直接用浏览器打开即可。

风格切换就是 CSS 切换，不需要多个 HTML：三套样式（编辑风 / 科技感 / 极客风）都内置在同一个文件里，在页面「个性化设置 · 界面风格」里切换，默认科技感。

原型页面结构（5 个视图）：

1. **今日资讯** —— 主题筛选 + 紧凑列表（一行一条），每个身份默认 15 条；条目只展示序号、来源（公司名或大 V + 来源平台）、标题、时间
2. **我的主题** —— 一句话订主题，选来源类型与收集频率
3. **资讯详情** —— 人话摘要 3 点 + 原文入口 + 反馈按钮（收藏 / 少推这类）
4. **个性化设置** —— 所有设置统一收在这里：空间（多租户：个人 / 家庭 / 团队）、身份（小白 / 开发者 / 关注行业）、界面风格、推送时间、过滤规则
5. **原型导览** —— 页面结构 / 核心功能 / 交互流程总览

核心功能只留 4 个：订主题 → 定时收集 → 千人千面 → 反馈调教。设计原则：按小白思维，功能不追求多，够用、看得懂优先。

## 架构与实现（v1）

架构设计见 [docs/architecture.md](docs/architecture.md)（已定稿）。按该文档实现的 TS monorepo：

```
apps/web          Next.js 前端（今日资讯 / 我的主题 / 详情 / 个性化设置 / 登录）
apps/api          NestJS API（租户、主题、资讯流、混合排序、API 上传入口）
workers/collector 采集（adapter 架构：RSS / 网页 / X；API 上传走 api 的 ingest）
workers/cleaner   清洗（质量门 → 双版本摘要 → 标签/重要度 → embedding → 入库）
packages/storage  Drizzle 数据访问层（PostgreSQL + pgvector，全仓唯一入口）
packages/shared   共享类型、adapter 接口约定、本地 embedding 兜底
```

### 运行（Docker Compose）

```bash
cp .env.example .env
docker compose up -d --build
# 首次启动后跑数据库迁移（迁移 SQL 头部会自动启用 pgvector 扩展）
docker compose run --rm api pnpm --filter @agentic-news/storage db:migrate
```

打开 http://localhost:3000 ，注册账号 → 在「我的主题」建主题并挂 RSS/网页/X 来源 → collector 按间隔抓取、cleaner 清洗后，「今日资讯」会出现按你口味排序的内容。

### 本地开发（不用 Docker 起前端/后端时）

需要自备 PostgreSQL（带 pgvector）与 Redis，然后：

```bash
pnpm install
pnpm --filter @agentic-news/storage db:migrate   # 先设好 DATABASE_URL
pnpm build                                       # 全仓构建
pnpm --filter @agentic-news/api start            # :3001
pnpm --filter @agentic-news/collector start
pnpm --filter @agentic-news/cleaner start
pnpm --filter @agentic-news/web dev              # :3000
pnpm test                                        # 单元测试（排序 / 质量门 / 网页提取）
```

说明：

- **LLM / Embedding 默认 `local`**：抽取式摘要 + 本地确定性向量，不需要任何 Key 即可跑通全链路；在 `.env` 里配 `OPENAI_API_KEY` 并把 `LLM_PROVIDER` / `EMBEDDING_PROVIDER` 设为 `openai` 即切换真实模型（见 docs 待定项 1）。
- **X 采集**需要 `X_BEARER_TOKEN`（应用级，官方 API 按量付费）；未配置时 X adapter 自动跳过，不影响其他来源。
- **API 上传**：在「个性化设置」里创建 Key 后，`POST /api/ingest/items`（请求头 `X-API-Key`）即可上传；上传内容默认公共、进全局共享池，过 cleaner 质量门后可见。
