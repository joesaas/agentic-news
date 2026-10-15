import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import type { FeedbackAction } from "@agentic-news/shared";
import * as storage from "@agentic-news/storage";
import type { TenantCtx } from "@agentic-news/storage";
import { CurrentCtx, TenantGuard } from "./auth";
import { getDb } from "./providers";
import { RankService } from "./rank.service";
import { VectorsService } from "./vectors.service";

@Controller()
@UseGuards(TenantGuard)
export class FeedController {
  constructor(
    private rank: RankService,
    private vectors: VectorsService,
  ) {}

  /** 今日资讯：混合排序后的个性化列表（一期默认 15 条，与原型一致） */
  @Get("feed")
  async feed(@CurrentCtx() ctx: TenantCtx, @Query("limit") limit?: string) {
    const parsed = limit ? Number(limit) : NaN;
    const items = await this.rank.rankFeed(ctx, {
      limit: Number.isFinite(parsed) ? Math.min(50, Math.max(1, parsed)) : 15,
    });
    return { items };
  }

  @Get("items/:id")
  async item(@Param("id") id: string) {
    const found = await storage.getItemById(getDb(), id);
    if (!found) throw new NotFoundException("item not found");
    const { item, source } = found;
    return {
      id: item.id,
      title: item.title,
      url: item.url,
      summaryEasy: item.summaryEasy,
      summaryPro: item.summaryPro,
      sourceName: source.name,
      platform: source.platform,
      tags: item.tags,
      importance: item.importance,
      publishedAt: item.publishedAt.toISOString(),
    };
  }

  /** 反馈：记录后异步刷新兴趣向量（Step 4） */
  @Post("feedback")
  async feedback(
    @CurrentCtx() ctx: TenantCtx,
    @Body() body: { itemId?: string; action?: FeedbackAction },
  ) {
    if (!body.itemId || !body.action) throw new NotFoundException("itemId/action required");
    await storage.recordFeedback(getDb(), ctx, {
      itemId: body.itemId,
      action: body.action,
    });
    void this.vectors.rebuildInterestVector(ctx);
    return { ok: true };
  }
}
