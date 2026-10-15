# agentic-news 架构设计

> 状态：v1 定稿待确认（2026-10-15）。本文只做设计，不含实现。
> 产品一句话：支持个性化的多租户资讯平台 —— 用户给定主题，系统定时收集事件、Blog 与动态，按每个人的身份和口味排序展示，千人千面。产品原型见 `../prototype/`。

## 决策总览

| # | 决定 | 结论 |
| --- | --- | --- |
| 1 | 产品定位 | 一期直接按**公开 SaaS** 设计：多租户隔离、扩展性从第一天考虑 |
| 2 | 系统形态 | **微服务**，一开始就拆开；模块边界见 Step 2 |
| 3 | 最上层架构 | **TS monorepo**，顶层 5 单元：Web UI、API、数据收集、数据清洗、数据存储 |
| 4 | 数据来源 | 一期最小闭环：RSS/官网 + 网页 + X；collector 用 **adapter 架构**；支持 API 上传 |
| 5 | 数据口径 | 收集与上传的数据**默认都是公共的**，进全局共享池，全局去重 |
| 6 | 个性化 | **向量相似度 + 规则混合**排序，一步到位 |
| 7 | 存储 | **PostgreSQL + pgvector** 一个库全包；共享存储包，各模块直连数据库 |
| 8 | 技术栈 | pnpm + Turborepo / Next.js / NestJS / BullMQ + Redis / Drizzle / Docker Compose |
| 9 | 推送渠道 | 一期**只站内**，不做邮件/IM 等外部推送 |

## Step 1 · 定位与规模

公开 SaaS 意味着以下能力从第一天就在架构内，不留后补：租户注册与隔离、登录鉴权、全入口限流、按租户用量记账（usage_records，一期只记账不收费）。

## Step 2 · 系统全景

概念上分 4 层 9 个模块；落到代码仓库（Step 3 的 monorepo）时收拢为 5 个顶层单元，映射如下：

| 概念模块 | 落位 |
| --- | --- |
| Web 前端、API 网关 | `apps/web`、`apps/api`（网关职责在 API：登录态、限流、租户上下文） |
| 租户与账号、主题与订阅、资讯流、个性化引擎 | `apps/api` 内的独立模块 |
| 收集管线 | `workers/collector` |
| 内容处理（清洗、摘要、打标、向量化） | `workers/cleaner` |
| 数据与队列、推送通知（站内）、管理后台与监控 | `packages/storage`、Redis/BullMQ、站内通知在 `apps/api`、监控随部署 |

```
agentic-news/                 TS monorepo（pnpm workspace + Turborepo）
├─ apps/
│  ├─ web/                    Next.js —— 原型 5 个视图的正式版
│  └─ api/                    NestJS —— 对外唯一公开入口
│        ├─ tenant/           租户、用户、成员、画像、API Key
│        ├─ topic/            主题与订阅
│        ├─ feed/             资讯流、详情、反馈
│        ├─ rank/             个性化排序（向量 + 规则）
│        └─ ingest/           API 上传入口（鉴权后转发队列）
├─ workers/
│  ├─ collector/              NestJS 独立进程 —— 调度 + adapter 采集
│  └─ cleaner/                NestJS 独立进程 —— 清洗、摘要、标签、embedding
├─ packages/
│  ├─ storage/                Drizzle —— 表结构与全部数据访问函数
│  └─ shared/                 共享类型（RawItem 等）、接口约定、配置
├─ prototype/                 已交付的产品原型
└─ docs/                      本文档
```

服务间通信：同步走 HTTP API，异步（采集→清洗→入库）走 BullMQ 队列。每个 worker 是独立容器，可单独扩副本。

## Step 3 · 数据怎么进来（collector）

管线：订主题 → 调度 → adapter 采集 → 队列 → cleaner → 入库 → 排序展示。

**Adapter 架构**：collector 内核只负责调度、派活、写原始条目，不认识具体来源。每个 adapter 实现同一套约定：

- `type`：`rss` / `web` / `x` / `api-upload`
- `validate(config)`：校验来源配置（地址、账号、频率）
- `fetch(cursor)`：从游标处增量抓取，输出统一的 `RawItem`（标题、链接、正文、作者、来源名 + 平台、发布时间、外部 ID）

一期 4 个 adapter：RssAdapter、WebAdapter、XAdapter（拉取型，调度触发）与 ApiUploadAdapter（推送型）。以后新增来源 = 新增一个 adapter，内核与 cleaner 不动。

**API 上传**：入口在 `apps/api` 的 ingest 模块（不在 collector）。流程：API Key 鉴权 → 校验与租户标记 → 转发队列 → 与抓取内容走同一条清洗管线。上传者身份保留在条目来源标记中，可追溯。

**数据口径**：全部数据（抓取 + 上传）默认公共、进全局共享池、全局按去重键去重。因此上传入池前必须过 cleaner 质量门（去重、垃圾与营销过滤），防止公共池被污染。

**可靠性**：每个来源存采集游标，重启断点续抓；队列失败重试（退避 + 死信队列）；cleaner 按去重键幂等。

## Step 4 · 千人千面（个性化与多租户）

**两层分离**（本设计省钱的关键）：

- **内容层全局共享**：同一内容无论被多少租户订阅，只抓一次、洗一次、生成一次摘要与 embedding。租户增长不线性推高内容成本。
- **个性化层在读时计算**：`apps/api` 的 rank 模块按请求用户的画像实时算分，不预生成每个人的列表。

**排序（混合）**：

```
score = w1 · 向量相似度(用户兴趣向量, 内容 embedding)
      + w2 · 规则分(主题匹配、来源权重、新鲜度、重要度)
```

- 内容 embedding 由 cleaner 生成（标题 + 摘要）；摘要生成两个深浅版本（小白版 / 进阶版），按用户身份选版本展示。
- 用户兴趣向量：以所订主题文本的向量为种子；点开/收藏加权、点「少推这类」减权，随反馈持续更新（user_vectors）。
- 冷启动：新用户靠主题种子向量 + 规则分兜底，第一天可用。
- 权重 w1/w2 与规则参数放配置，可调、可按租户覆盖。

**多租户隔离**：租户表全部带 `tenant_id`；storage 包每个函数必须显式接收租户上下文；租户身份只从登录态推导，不信任前端传参；跨租户隔离有专门自动化测试（定为一级事故防线）。

## Step 5 · 数据模型与存储

存储：PostgreSQL + pgvector（一库同时装关系数据与向量）。访问纪律：

- 全部数据库访问只走 `packages/storage` 的函数，各模块不散写 SQL。
- storage 内按模块划分表的所有权：订阅类表归 API 写、raw_items 归 collector 写、items 归 cleaner 写，其余只读。

核心实体：

| 分组 | 表 | 说明 |
| --- | --- | --- |
| 租户侧 | tenants / users / tenant_members | 空间、用户、成员与角色 |
| 租户侧 | profiles | 身份、深浅偏好、推送时间、过滤规则 |
| 租户侧 | topics | 订阅：主题词、来源配置、频率；带 tenant_id |
| 租户侧 | api_keys | 上传鉴权；只存哈希，明文仅创建时展示一次 |
| 内容侧（全局） | sources | 来源注册表：公司/大 V + 平台 + adapter 配置 |
| 内容侧（全局） | raw_items | 原始条目 + 采集游标/去重键 |
| 内容侧（全局） | items | 清洗后内容：双版本摘要、标签、重要度、embedding、来源与上传者标记 |
| 行为侧 | feedback | 用户 × 条目 × 动作（点开/收藏/少推） |
| 行为侧 | user_vectors | 用户兴趣向量，随反馈更新 |
| 行为侧 | usage_records | 按租户计量：采集量、LLM 用量、X API 用量 |

队列与缓存：Redis（BullMQ 队列 + 热点缓存 + 限流计数）。

## Step 6 · 技术选型与部署

| 层 | 选型 | 理由（一句） |
| --- | --- | --- |
| monorepo | pnpm workspace + Turborepo | 轻、快，TS 生态事实标准 |
| Web | Next.js | SSR 对公开 SaaS 的 SEO/首屏友好 |
| API / workers | NestJS | 模块边界硬，配微服务拆法 |
| 队列 / 缓存 | BullMQ + Redis | TS 生态最顺手的异步组合 |
| 数据访问 | Drizzle | 贴 SQL、类型安全、pgvector 支持顺 |
| 数据库 | PostgreSQL + pgvector | 关系 + 向量一库全包 |
| 部署 | Docker Compose（一期） | 每服务一容器，先跑 1–2 台云主机 |

演进路径（不在一期范围，边界为此预留）：单服务扩副本 → 需要时上 K8s；向量规模超限时把向量检索从 pgvector 拆到独立向量库（接口已在 storage 包隔离）。

## Step 7 · 非功能项

- **成本闸门**：LLM 只处理至少命中一个在订主题的内容；摘要/embedding 全局只生成一次；X API 按量付费（2026-10 核实价：读帖 $0.005/条，同帖同日重复不重复计费），同帖同日只拉一次进共享池；usage_records 支撑随时查每个租户的成本。
- **安全**：密码与 API Key 均哈希存储；全入口限流；上传过质量门；密钥走环境/密钥管理，不进仓库。
- **可观测**：每服务结构化日志 + 健康检查；队列积压、采集失败率、LLM 失败率设告警（具体工具在实施阶段定）。
- **推送**：一期只站内（资讯流 + 站内汇总视图）；外部渠道（邮件/IM）不在一期，通知结构预留渠道扩展点。

## 待定项（不阻塞定稿，实施前确认）

1. LLM 供应商与模型：摘要生成用哪家、embedding 用哪家（影响成本与向量维度，items 表需预留模型版本字段）。
2. 登录方式：一期只做邮箱密码，还是同时上 OAuth（Google/GitHub）。
3. X API 账号与额度：需开发者账号充值，应用级 Bearer Token 即可满足只读采集。
