/**
 * collector 内核（Step 3）：只做调度、派活、写原始条目，不认识具体来源。
 * 每轮：查到期且被至少一个主题引用的来源（成本闸门在 storage.listDueSources）
 * → 按 type 找 adapter 抓取 → raw_items 落库（全局去重）
 * → 新条目进 raw-items 队列等 cleaner 处理 → 更新来源游标。
 */
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { QUEUES, type RawItemJob, type SourceConfig } from "@agentic-news/shared";
import * as storage from "@agentic-news/storage";
import { createAdapters } from "./adapters";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://agentic:agentic@localhost:5432/agentic_news";
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const TICK_MS = Number(process.env.COLLECTOR_TICK_MS ?? 60_000);

const { db } = storage.createDb(DATABASE_URL);
const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
const queue = new Queue<RawItemJob>(QUEUES.rawItems, { connection });
const adapters = createAdapters(process.env);

let running = false;

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const due = await storage.listDueSources(db, new Date());
    for (const source of due) {
      const adapter = adapters.get(source.type as never);
      if (!adapter) continue;
      try {
        const config = source.config as unknown as SourceConfig;
        const check = adapter.validate(config);
        if (!check.ok) {
          console.warn(`[collector] source ${source.id} invalid config: ${check.error}`);
          continue;
        }
        const { items, nextCursor } = await adapter.fetch(config, source.cursor);
        let fresh = 0;
        for (const raw of items) {
          const inserted = await storage.insertRawItem(db, {
            sourceId: source.id,
            raw: { ...raw, sourceName: raw.sourceName || source.name },
          });
          if (!inserted) continue; // 全局去重命中
          fresh++;
          await queue.add("clean", { rawItemId: inserted.id }, {
            jobId: inserted.id,
            attempts: 3,
            backoff: { type: "exponential", delay: 5000 },
            removeOnComplete: true,
          });
        }
        await storage.updateSourceCursor(db, source.id, nextCursor, new Date());
        if (fresh > 0) {
          await storage.recordUsage(db, {
            tenantId: null,
            kind: "collect_runs",
            amount: fresh,
            meta: { sourceId: source.id, type: source.type },
          });
          if (source.type === "x") {
            await storage.recordUsage(db, {
              tenantId: null,
              kind: "x_reads",
              amount: items.length,
              meta: { sourceId: source.id },
            });
          }
        }
        console.log(
          `[collector] ${source.type}:${source.name} fetched=${items.length} fresh=${fresh}`,
        );
      } catch (err) {
        // 单个来源失败不影响其他来源；游标不前进，下轮重试
        console.error(`[collector] source ${source.id} failed:`, err);
      }
    }
  } finally {
    running = false;
  }
}

console.log(`[collector] started, tick=${TICK_MS}ms`);
void tick();
setInterval(() => void tick(), TICK_MS);
