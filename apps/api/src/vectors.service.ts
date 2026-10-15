import { Injectable, Logger } from "@nestjs/common";
import { combineVectors, localEmbed } from "@agentic-news/shared";
import * as storage from "@agentic-news/storage";
import type { TenantCtx } from "@agentic-news/storage";
import { config } from "./config";
import { getDb } from "./providers";

/**
 * 兴趣向量维护（Step 4）：
 * 种子 = 所订主题标题+关键词的本地向量；点开 +0.5、收藏 +1.0、少推 −0.7 加权合成。
 * 说明：种子用本地向量只为冷启动可跑通；真实 embedding 接入后，
 * 主题种子应改走同一 embedding provider（见架构文档待定项 1）。
 */
@Injectable()
export class VectorsService {
  private readonly logger = new Logger(VectorsService.name);

  async rebuildInterestVector(ctx: TenantCtx): Promise<void> {
    try {
      const db = getDb();
      const topics = await storage.listTopics(db, ctx);
      const parts: Array<{ vector: number[]; weight: number }> = [];

      for (const t of topics) {
        const text = [t.title, ...((t.keywords as string[]) ?? [])].join(" ");
        parts.push({ vector: localEmbed(text, config.embeddingDim), weight: 1 });
      }
      const [savedIds, openedIds, lessIds] = await Promise.all([
        storage.listFeedbackItemIds(db, ctx, "save", 50),
        storage.listFeedbackItemIds(db, ctx, "open", 50),
        storage.listFeedbackItemIds(db, ctx, "less", 50),
      ]);
      const addFromItems = async (ids: string[], weight: number) => {
        const rows = await storage.getItemEmbeddings(db, ids);
        for (const r of rows)
          parts.push({ vector: r.embedding as number[], weight });
      };
      await addFromItems(savedIds, 1.0);
      await addFromItems(openedIds, 0.5);
      await addFromItems(lessIds, -0.7);

      const combined = combineVectors(parts);
      if (combined) await storage.upsertUserVector(db, ctx, combined);
    } catch (err) {
      this.logger.warn(`rebuildInterestVector failed: ${String(err)}`);
    }
  }
}
