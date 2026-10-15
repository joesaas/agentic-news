/**
 * 数据模型（docs/architecture.md Step 5）
 * 存储：PostgreSQL + pgvector 一库全包。
 * 分组：租户侧（带 tenant_id）/ 内容侧（全局共享，不带租户）/ 行为侧。
 * 注意：embedding 维度与所选 embedding 模型绑定（默认 1536）；
 * 换维度不同的模型时需生成新迁移（见架构文档“待定项 1”）。
 */
import {
  customType,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  boolean,
} from "drizzle-orm/pg-core";

export const EMBEDDING_DIM = 1536;

const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return `vector(${EMBEDDING_DIM})`;
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string): number[] {
    return value
      .replace(/^\[|\]$/g, "")
      .split(",")
      .filter((s) => s.length > 0)
      .map(Number);
  },
});

// ---------------- 租户侧 ----------------

export const tenants = pgTable("tenants", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  /** 只存哈希（Step 7） */
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const tenantMembers = pgTable(
  "tenant_members",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"), // owner | admin | member
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.userId] })],
);

export const profiles = pgTable(
  "profiles",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** beginner | developer | industry */
    identity: text("identity").notNull().default("beginner"),
    /** easy | pro：看小白版还是进阶版摘要 */
    depth: text("depth").notNull().default("easy"),
    pushTime: text("push_time").notNull().default("08:00"),
    /** 过滤规则，如 { blockedKeywords: string[], blockedSources: string[] } */
    filters: jsonb("filters").notNull().default({}),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.userId] })],
);

export const topics = pgTable("topics", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id),
  title: text("title").notNull(),
  keywords: jsonb("keywords").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  name: text("name").notNull(),
  /** sha256 哈希，明文只在创建时展示一次（Step 7） */
  keyHash: text("key_hash").notNull().unique(),
  /** 明文前缀（如 agk_ab12），仅用于列表辨认，不是凭证 */
  prefix: text("prefix").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

// ---------------- 内容侧（全局共享） ----------------

export const sources = pgTable("sources", {
  id: uuid("id").defaultRandom().primaryKey(),
  /** rss | web | x | api-upload */
  type: text("type").notNull(),
  name: text("name").notNull(),
  platform: text("platform").notNull(),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  active: boolean("active").notNull().default(true),
  /** adapter 增量游标（语义由 adapter 定义） */
  cursor: text("cursor"),
  lastFetchedAt: timestamp("last_fetched_at", { withTimezone: true }),
  intervalMinutes: integer("interval_minutes").notNull().default(60),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/** 主题 ↔ 来源 关联（辅助表）：来源被至少一个主题引用才会被采集（成本闸门，Step 7） */
export const topicSources = pgTable(
  "topic_sources",
  {
    topicId: uuid("topic_id")
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.topicId, t.sourceId] })],
);

export const rawItems = pgTable(
  "raw_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceId: uuid("source_id").references(() => sources.id, { onDelete: "set null" }),
    dedupeKey: text("dedupe_key").notNull(),
    /** 完整 RawItem（见 @agentic-news/shared） */
    payload: jsonb("payload").notNull(),
    /** pending | cleaned | rejected */
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("raw_items_dedupe_key_idx").on(t.dedupeKey)],
);

export const items = pgTable("items", {
  id: uuid("id").defaultRandom().primaryKey(),
  sourceId: uuid("source_id")
    .notNull()
    .references(() => sources.id),
  rawItemId: uuid("raw_item_id")
    .notNull()
    .unique()
    .references(() => rawItems.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  url: text("url").notNull(),
  summaryEasy: text("summary_easy").notNull(),
  summaryPro: text("summary_pro").notNull(),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  importance: integer("importance").notNull().default(50),
  embedding: vector("embedding").notNull(),
  embeddingModel: text("embedding_model").notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ---------------- 行为侧 ----------------

export const feedback = pgTable(
  "feedback",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    /** open | save | less */
    action: text("action").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("feedback_unique_idx").on(t.tenantId, t.userId, t.itemId, t.action)],
);

export const userVectors = pgTable(
  "user_vectors",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    vector: vector("vector").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.userId] })],
);

export const usageRecords = pgTable("usage_records", {
  id: uuid("id").defaultRandom().primaryKey(),
  /** 全局成本（如公共来源的 LLM 处理）tenant_id 可空 */
  tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
  /** llm_tokens | embedding_tokens | x_reads | collect_runs | uploads */
  kind: text("kind").notNull(),
  amount: integer("amount").notNull(),
  meta: jsonb("meta").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
