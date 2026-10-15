import { Injectable } from "@nestjs/common";
import {
  DEFAULT_RANK_WEIGHTS,
  type RankWeights,
} from "@agentic-news/shared";
import * as storage from "@agentic-news/storage";
import type { TenantCtx } from "@agentic-news/storage";
import { getDb } from "./providers";

/**
 * 混合排序（Step 4）：score = w1·向量相似度 + w2·规则分。
 * 规则分 = 0.4·主题匹配 + 0.3·新鲜度 + 0.3·重要度。
 * 本函数纯计算、可单测；DB 取数在 RankService.rankFeed。
 */
export function computeRuleScore(input: {
  tags: string[];
  title: string;
  importance: number;
  publishedAt: Date;
  topicKeywords: string[];
  now: Date;
}): number {
  const haystack = `${input.title} ${input.tags.join(" ")}`.toLowerCase();
  const matched = input.topicKeywords.filter((k) =>
    haystack.includes(k.toLowerCase()),
  ).length;
  const topicMatch =
    input.topicKeywords.length === 0 ? 0.5 : matched / input.topicKeywords.length;
  const ageHours = Math.max(
    0,
    (input.now.getTime() - input.publishedAt.getTime()) / 3_600_000,
  );
  const freshness = Math.exp(-ageHours / 48); // 48 小时半衰（指数衰减）
  const importance = Math.min(100, Math.max(0, input.importance)) / 100;
  return 0.4 * topicMatch + 0.3 * freshness + 0.3 * importance;
}

export function combineScore(
  similarity: number | null,
  ruleScore: number,
  topicMatchFallback: number,
  weights: RankWeights = DEFAULT_RANK_WEIGHTS,
): number {
  // 无兴趣向量（冷启动）时用主题匹配度顶替向量分，靠规则兜底（Step 4）
  const vec = similarity === null ? topicMatchFallback : Math.max(0, similarity);
  return weights.vector * vec + weights.rule * ruleScore;
}

export interface FeedEntry {
  id: string;
  title: string;
  url: string;
  summary: string;
  sourceName: string;
  platform: string;
  tags: string[];
  importance: number;
  publishedAt: string;
  score: number;
  /** 推荐理由（可解释性：告诉用户为什么推给你） */
  reason: string;
}

@Injectable()
export class RankService {
  async rankFeed(
    ctx: TenantCtx,
    options: { limit?: number; weights?: RankWeights } = {},
  ): Promise<FeedEntry[]> {
    const db = getDb();
    const limit = options.limit ?? 15;
    const weights = options.weights ?? DEFAULT_RANK_WEIGHTS;
    const now = new Date();
    const since = new Date(now.getTime() - 7 * 24 * 3_600_000);

    const [profile, topicRows, userVector, lessIds] = await Promise.all([
      storage.getProfile(db, ctx),
      storage.listTopics(db, ctx),
      storage.getUserVector(db, ctx),
      storage.listFeedbackItemIds(db, ctx, "less", 500),
    ]);
    const keywords = topicRows.flatMap((t) => [
      t.title,
      ...((t.keywords as string[]) ?? []),
    ]);
    const filters = (profile?.filters ?? {}) as {
      blockedKeywords?: string[];
      blockedSources?: string[];
    };
    const blockedKw = (filters.blockedKeywords ?? []).map((s) => s.toLowerCase());
    const blockedSrc = filters.blockedSources ?? [];
    const lessSet = new Set(lessIds);

    // 向量相似度（有兴趣向量时用 pgvector 检索）
    const simByItem = new Map<string, number>();
    if (userVector) {
      const hits = await storage.searchItemsByVector(
        db,
        userVector.vector as number[],
        since,
        200,
      );
      for (const h of hits) simByItem.set(h.itemId, h.similarity);
    }

    const candidates = await storage.listRecentItems(db, since, 300);
    const depth = profile?.depth ?? "easy";

    const scored: FeedEntry[] = [];
    for (const { item, source } of candidates) {
      if (lessSet.has(item.id)) continue;
      if (blockedSrc.includes(source.id)) continue;
      const titleLower = item.title.toLowerCase();
      if (blockedKw.some((k) => titleLower.includes(k))) continue;

      const tags = (item.tags as string[]) ?? [];
      const rule = computeRuleScore({
        tags,
        title: item.title,
        importance: item.importance,
        publishedAt: item.publishedAt,
        topicKeywords: keywords,
        now,
      });
      const matchedKw = keywords.filter((k) =>
        `${item.title} ${tags.join(" ")}`.toLowerCase().includes(k.toLowerCase()),
      );
      const topicFallback = keywords.length
        ? matchedKw.length / keywords.length
        : 0.5;
      const sim = simByItem.has(item.id) ? simByItem.get(item.id)! : null;
      const score = combineScore(sim, rule, topicFallback, weights);

      const reasonParts: string[] = [];
      if (matchedKw.length) reasonParts.push(`命中主题词：${matchedKw.slice(0, 3).join("、")}`);
      if (sim !== null && sim > 0.5) reasonParts.push("与你的兴趣向量高度相似");
      if (item.importance >= 80) reasonParts.push("重要度高");
      if (reasonParts.length === 0) reasonParts.push("新鲜资讯");

      scored.push({
        id: item.id,
        title: item.title,
        url: item.url,
        summary: depth === "pro" ? item.summaryPro : item.summaryEasy,
        sourceName: source.name,
        platform: source.platform,
        tags,
        importance: item.importance,
        publishedAt: item.publishedAt.toISOString(),
        score,
        reason: reasonParts.join("；"),
      });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }
}
