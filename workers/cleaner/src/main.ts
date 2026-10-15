/**
 * cleaner（Step 3 管线后半段）：消费 raw-items 队列。
 * 流程：取 raw_items → 质量门 → LLM 双版本摘要/标签/重要度 → embedding → 写 items。
 * 幂等：jobId = rawItemId 且 items.raw_item_id 唯一，重复投递不会洗出两条（Step 7）。
 */
import { Worker } from "bullmq";
import IORedis from "ioredis";
import { QUEUES, type RawItem, type RawItemJob } from "@agentic-news/shared";
import * as storage from "@agentic-news/storage";
import { createProviders } from "./providers";
import { checkQuality } from "./quality";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://agentic:agentic@localhost:5432/agentic_news";
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

const { db } = storage.createDb(DATABASE_URL);
const { llm, embedding } = createProviders(process.env);

console.log(`[cleaner] llm=${llm.name} embedding=${embedding.name}/${embedding.model}`);

const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });

const worker = new Worker<RawItemJob>(
  QUEUES.rawItems,
  async (job) => {
    const row = await storage.getRawItem(db, job.data.rawItemId);
    if (!row) return;
    if (row.status !== "pending") return; // 幂等：已处理过
    const raw = row.payload as RawItem;

    const quality = checkQuality(raw);
    if (!quality.ok) {
      await storage.setRawItemStatus(db, row.id, "rejected");
      console.log(`[cleaner] rejected ${row.id}: ${quality.reason}`);
      return;
    }
    if (!row.sourceId) {
      // items.source_id 非空约束：无来源的条目不入池（ingest/collector 都会带来源，理论上到不了这）
      await storage.setRawItemStatus(db, row.id, "rejected");
      console.log(`[cleaner] rejected ${row.id}: missing sourceId`);
      return;
    }

    const summary = await llm.summarize({ title: raw.title, content: raw.content });
    const embedded = await embedding.embed(`${raw.title}\n${summary.summaryPro}`);
    if (summary.tokens > 0)
      await storage.recordUsage(db, {
        tenantId: null,
        kind: "llm_tokens",
        amount: summary.tokens,
        meta: { rawItemId: row.id },
      });
    if (embedded.tokens > 0)
      await storage.recordUsage(db, {
        tenantId: null,
        kind: "embedding_tokens",
        amount: embedded.tokens,
        meta: { rawItemId: row.id },
      });

    await storage.insertItem(db, {
      sourceId: row.sourceId,
      rawItemId: row.id,
      title: raw.title,
      url: raw.url,
      summaryEasy: summary.summaryEasy,
      summaryPro: summary.summaryPro,
      tags: summary.tags,
      importance: summary.importance,
      embedding: embedded.vector,
      embeddingModel: embedding.model,
      publishedAt: new Date(raw.publishedAt),
    });
    await storage.setRawItemStatus(db, row.id, "cleaned");
    console.log(`[cleaner] cleaned ${row.id}: ${raw.title.slice(0, 60)}`);
  },
  { connection, concurrency: 4 },
);

worker.on("failed", (job, err) => {
  console.error(`[cleaner] job ${job?.id} failed:`, err);
});

console.log("[cleaner] worker started");
