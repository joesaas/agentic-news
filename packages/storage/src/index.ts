/**
 * @agentic-news/storage —— 全仓唯一的数据库访问入口（Step 5 纪律）。
 * - 其他模块禁止散写 SQL，一律走这里的函数。
 * - 表所有权：订阅类表归 API 写；raw_items 归 collector/ingest 写；items 归 cleaner 写；其余按函数注释。
 * - 租户侧函数必须显式接收 TenantCtx，租户只从登录态推导（Step 4）。
 */
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { FeedbackAction, RawItem, SourceAdapterType } from "@agentic-news/shared";
import type { Db } from "./client";
import {
  apiKeys,
  feedback,
  items,
  profiles,
  rawItems,
  sources,
  tenants,
  tenantMembers,
  topics,
  topicSources,
  usageRecords,
  users,
  userVectors,
} from "./schema";

export { createDb, type Db } from "./client";
export * as schema from "./schema";

export interface TenantCtx {
  tenantId: string;
  userId: string;
}

// ---------------- 用户与租户（归 API 写） ----------------

export async function createUser(
  db: Db,
  input: { email: string; passwordHash: string; name: string },
) {
  const [row] = await db.insert(users).values(input).returning();
  return row;
}

export async function findUserByEmail(db: Db, email: string) {
  const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return row ?? null;
}

export async function findUserById(db: Db, id: string) {
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return row ?? null;
}

/** 建租户：同时写 owner 成员关系与默认画像 */
export async function createTenant(db: Db, input: { name: string; ownerUserId: string }) {
  const [tenant] = await db.insert(tenants).values({ name: input.name }).returning();
  await db
    .insert(tenantMembers)
    .values({ tenantId: tenant.id, userId: input.ownerUserId, role: "owner" });
  await db.insert(profiles).values({ tenantId: tenant.id, userId: input.ownerUserId });
  return tenant;
}

export async function listUserTenants(db: Db, userId: string) {
  return db
    .select({ tenant: tenants, role: tenantMembers.role })
    .from(tenantMembers)
    .innerJoin(tenants, eq(tenantMembers.tenantId, tenants.id))
    .where(eq(tenantMembers.userId, userId));
}

/** 校验成员关系：非成员返回 null —— 租户隔离的第一道闸 */
export async function getMembership(db: Db, ctx: TenantCtx) {
  const [row] = await db
    .select()
    .from(tenantMembers)
    .where(
      and(eq(tenantMembers.tenantId, ctx.tenantId), eq(tenantMembers.userId, ctx.userId)),
    )
    .limit(1);
  return row ?? null;
}

export async function getProfile(db: Db, ctx: TenantCtx) {
  const [row] = await db
    .select()
    .from(profiles)
    .where(and(eq(profiles.tenantId, ctx.tenantId), eq(profiles.userId, ctx.userId)))
    .limit(1);
  return row ?? null;
}

export async function upsertProfile(
  db: Db,
  ctx: TenantCtx,
  patch: Partial<{ identity: string; depth: string; pushTime: string; filters: unknown }>,
) {
  const existing = await getProfile(db, ctx);
  if (!existing) {
    const [row] = await db
      .insert(profiles)
      .values({ tenantId: ctx.tenantId, userId: ctx.userId, ...patch })
      .returning();
    return row;
  }
  const [row] = await db
    .update(profiles)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(profiles.tenantId, ctx.tenantId), eq(profiles.userId, ctx.userId)))
    .returning();
  return row;
}

// ---------------- 主题与来源（归 API 写） ----------------

export async function createTopic(
  db: Db,
  ctx: TenantCtx,
  input: { title: string; keywords: string[] },
) {
  const [row] = await db
    .insert(topics)
    .values({ tenantId: ctx.tenantId, createdBy: ctx.userId, ...input })
    .returning();
  return row;
}

export async function listTopics(db: Db, ctx: TenantCtx) {
  return db
    .select()
    .from(topics)
    .where(eq(topics.tenantId, ctx.tenantId))
    .orderBy(desc(topics.createdAt));
}

export async function getTopic(db: Db, ctx: TenantCtx, topicId: string) {
  const [row] = await db
    .select()
    .from(topics)
    .where(and(eq(topics.id, topicId), eq(topics.tenantId, ctx.tenantId)))
    .limit(1);
  return row ?? null;
}

export async function deleteTopic(db: Db, ctx: TenantCtx, topicId: string) {
  await db
    .delete(topics)
    .where(and(eq(topics.id, topicId), eq(topics.tenantId, ctx.tenantId)));
}

/** 全局来源注册表：同 type+同 target 视为同一来源 */
export async function findOrCreateSource(
  db: Db,
  input: {
    type: SourceAdapterType;
    name: string;
    platform: string;
    config: Record<string, unknown>;
    intervalMinutes?: number;
  },
) {
  const target = String(input.config.target ?? "");
  const all = await db.select().from(sources).where(eq(sources.type, input.type));
  const found = all.find(
    (s) => String((s.config as Record<string, unknown>).target ?? "") === target,
  );
  if (found) return found;
  const [row] = await db
    .insert(sources)
    .values({
      type: input.type,
      name: input.name,
      platform: input.platform,
      config: input.config,
      intervalMinutes: input.intervalMinutes ?? 60,
    })
    .returning();
  return row;
}

export async function linkTopicSource(db: Db, topicId: string, sourceId: string) {
  await db.insert(topicSources).values({ topicId, sourceId }).onConflictDoNothing();
}

export async function listTopicSources(db: Db, topicId: string) {
  return db
    .select({ source: sources })
    .from(topicSources)
    .innerJoin(sources, eq(topicSources.sourceId, sources.id))
    .where(eq(topicSources.topicId, topicId));
}

export async function getSourceById(db: Db, id: string) {
  const [row] = await db.select().from(sources).where(eq(sources.id, id)).limit(1);
  return row ?? null;
}

// ---------------- 采集（归 collector / ingest 写） ----------------

/** 到期且被至少一个主题引用的活跃来源 —— 成本闸门在查询层落地（Step 7） */
export async function listDueSources(db: Db, now: Date) {
  const rows = await db
    .selectDistinct({ source: sources })
    .from(sources)
    .innerJoin(topicSources, eq(topicSources.sourceId, sources.id))
    .where(eq(sources.active, true));
  return rows
    .map((r) => r.source)
    .filter((s) => {
      if (!s.lastFetchedAt) return true;
      const dueAt = s.lastFetchedAt.getTime() + s.intervalMinutes * 60_000;
      return dueAt <= now.getTime();
    });
}

export async function updateSourceCursor(
  db: Db,
  sourceId: string,
  cursor: string | null,
  fetchedAt: Date,
) {
  await db
    .update(sources)
    .set({ cursor, lastFetchedAt: fetchedAt })
    .where(eq(sources.id, sourceId));
}

/** 插入原始条目：dedupeKey 全局唯一，冲突即已存在，返回 null（幂等） */
export async function insertRawItem(
  db: Db,
  input: { sourceId: string | null; raw: RawItem },
): Promise<{ id: string } | null> {
  const [row] = await db
    .insert(rawItems)
    .values({
      sourceId: input.sourceId,
      dedupeKey: input.raw.dedupeKey,
      payload: input.raw,
    })
    .onConflictDoNothing({ target: rawItems.dedupeKey })
    .returning({ id: rawItems.id });
  return row ?? null;
}

export async function getRawItem(db: Db, id: string) {
  const [row] = await db.select().from(rawItems).where(eq(rawItems.id, id)).limit(1);
  return row ?? null;
}

export async function setRawItemStatus(db: Db, id: string, status: "cleaned" | "rejected") {
  await db.update(rawItems).set({ status }).where(eq(rawItems.id, id));
}

// ---------------- 内容（归 cleaner 写，API 只读） ----------------

export async function insertItem(
  db: Db,
  input: {
    sourceId: string;
    rawItemId: string;
    title: string;
    url: string;
    summaryEasy: string;
    summaryPro: string;
    tags: string[];
    importance: number;
    embedding: number[];
    embeddingModel: string;
    publishedAt: Date;
  },
) {
  const [row] = await db.insert(items).values(input).returning();
  return row;
}

export async function getItemById(db: Db, id: string) {
  const rows = await db
    .select({ item: items, source: sources })
    .from(items)
    .innerJoin(sources, eq(items.sourceId, sources.id))
    .where(eq(items.id, id))
    .limit(1);
  return rows[0] ?? null;
}

/** 规则排序的候选集：近 N 天内容（向量相似度在 searchItemsByVector 里算） */
export async function listRecentItems(db: Db, since: Date, limit: number) {
  return db
    .select({ item: items, source: sources })
    .from(items)
    .innerJoin(sources, eq(items.sourceId, sources.id))
    .where(sql`${items.publishedAt} >= ${since}`)
    .orderBy(desc(items.publishedAt))
    .limit(limit);
}

/** pgvector 余弦相似检索：返回条目 + 相似度（0-1，越大越像） */
export async function searchItemsByVector(
  db: Db,
  vector: number[],
  since: Date,
  limit: number,
) {
  const vec = `[${vector.join(",")}]`;
  const rows = (await db.execute(sql`
    SELECT i.id AS item_id, 1 - (i.embedding <=> ${vec}::vector) AS similarity
    FROM items i
    WHERE i.published_at >= ${since}
    ORDER BY i.embedding <=> ${vec}::vector
    LIMIT ${limit}
  `)) as unknown as { rows: Array<{ item_id: string; similarity: number }> };
  return rows.rows.map((r) => ({ itemId: r.item_id, similarity: Number(r.similarity) }));
}

export async function getItemsWithSources(db: Db, ids: string[]) {
  if (ids.length === 0) return [];
  return db
    .select({ item: items, source: sources })
    .from(items)
    .innerJoin(sources, eq(items.sourceId, sources.id))
    .where(inArray(items.id, ids));
}

// ---------------- 行为（归 API 写） ----------------

export async function recordFeedback(
  db: Db,
  ctx: TenantCtx,
  input: { itemId: string; action: FeedbackAction },
) {
  await db
    .insert(feedback)
    .values({ tenantId: ctx.tenantId, userId: ctx.userId, ...input })
    .onConflictDoNothing();
}

export async function listFeedbackItemIds(
  db: Db,
  ctx: TenantCtx,
  action: FeedbackAction,
  limit: number,
) {
  const rows = await db
    .select({ itemId: feedback.itemId })
    .from(feedback)
    .where(
      and(
        eq(feedback.tenantId, ctx.tenantId),
        eq(feedback.userId, ctx.userId),
        eq(feedback.action, action),
      ),
    )
    .orderBy(desc(feedback.createdAt))
    .limit(limit);
  return rows.map((r) => r.itemId);
}

export async function getUserVector(db: Db, ctx: TenantCtx) {
  const [row] = await db
    .select()
    .from(userVectors)
    .where(and(eq(userVectors.tenantId, ctx.tenantId), eq(userVectors.userId, ctx.userId)))
    .limit(1);
  return row ?? null;
}

export async function upsertUserVector(db: Db, ctx: TenantCtx, vector: number[]) {
  await db
    .insert(userVectors)
    .values({ tenantId: ctx.tenantId, userId: ctx.userId, vector })
    .onConflictDoUpdate({
      target: [userVectors.tenantId, userVectors.userId],
      set: { vector, updatedAt: new Date() },
    });
}

/** 取一批条目的 embedding（兴趣向量更新时用） */
export async function getItemEmbeddings(db: Db, ids: string[]) {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: items.id, embedding: items.embedding, tags: items.tags })
    .from(items)
    .where(inArray(items.id, ids));
  return rows;
}

// ---------------- API Key（归 API 写，ingest 验） ----------------

export async function createApiKeyRow(
  db: Db,
  input: { tenantId: string; userId: string; name: string; keyHash: string; prefix: string },
) {
  const [row] = await db.insert(apiKeys).values(input).returning();
  return row;
}

export async function findActiveApiKeyByHash(db: Db, keyHash: string) {
  const [row] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, keyHash), isNull(apiKeys.revokedAt)))
    .limit(1);
  return row ?? null;
}

export async function touchApiKey(db: Db, id: string) {
  await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, id));
}

export async function listApiKeys(db: Db, ctx: TenantCtx) {
  return db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      prefix: apiKeys.prefix,
      createdAt: apiKeys.createdAt,
      lastUsedAt: apiKeys.lastUsedAt,
      revokedAt: apiKeys.revokedAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.tenantId, ctx.tenantId))
    .orderBy(desc(apiKeys.createdAt));
}

// ---------------- 计量（各服务按需写） ----------------

export async function recordUsage(
  db: Db,
  input: { tenantId: string | null; kind: string; amount: number; meta?: unknown },
) {
  await db.insert(usageRecords).values({
    tenantId: input.tenantId,
    kind: input.kind,
    amount: input.amount,
    meta: (input.meta ?? {}) as Record<string, unknown>,
  });
}
