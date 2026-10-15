import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import type { SourceAdapterType, SourceConfig } from "@agentic-news/shared";
import * as storage from "@agentic-news/storage";
import type { TenantCtx } from "@agentic-news/storage";
import { CurrentCtx, TenantGuard } from "./auth";
import { getDb } from "./providers";
import { VectorsService } from "./vectors.service";

/** 来源配置的轻量校验（collector 在抓取时按 adapter 约定再验一次） */
function validateSourceConfig(
  type: SourceAdapterType,
  config: SourceConfig,
): string | null {
  if (!config.target || typeof config.target !== "string") return "config.target required";
  if (type === "rss" || type === "web") {
    try {
      new URL(config.target);
    } catch {
      return "config.target must be a URL for rss/web";
    }
  }
  if (type === "x" && config.target.startsWith("http")) return "x target should be a username";
  if (type === "api-upload") return "api-upload sources are created via ingest, not topics";
  return null;
}

const PLATFORM_BY_TYPE: Record<string, string> = {
  rss: "官方 Blog",
  web: "网页",
  x: "X",
};

@Controller("topics")
@UseGuards(TenantGuard)
export class TopicsController {
  constructor(private vectors: VectorsService) {}

  @Get()
  async list(@CurrentCtx() ctx: TenantCtx) {
    const db = getDb();
    const rows = await storage.listTopics(db, ctx);
    const out = [];
    for (const t of rows) {
      const links = await storage.listTopicSources(db, t.id);
      out.push({
        ...t,
        sources: links.map((l) => ({
          id: l.source.id,
          type: l.source.type,
          name: l.source.name,
          platform: l.source.platform,
          config: l.source.config,
        })),
      });
    }
    return out;
  }

  @Post()
  async create(
    @CurrentCtx() ctx: TenantCtx,
    @Body() body: { title?: string; keywords?: string[] },
  ) {
    const title = body.title?.trim();
    if (!title) throw new BadRequestException("title required");
    const topic = await storage.createTopic(getDb(), ctx, {
      title,
      keywords: body.keywords ?? [],
    });
    void this.vectors.rebuildInterestVector(ctx);
    return topic;
  }

  @Delete(":id")
  async remove(@CurrentCtx() ctx: TenantCtx, @Param("id") id: string) {
    await storage.deleteTopic(getDb(), ctx, id);
    void this.vectors.rebuildInterestVector(ctx);
    return { ok: true };
  }

  /** 给主题挂一个来源（rss/web/x）：写入全局来源注册表并建立关联，collector 随后按计划采集 */
  @Post(":id/sources")
  async attachSource(
    @CurrentCtx() ctx: TenantCtx,
    @Param("id") id: string,
    @Body()
    body: {
      type?: SourceAdapterType;
      name?: string;
      config?: SourceConfig;
      intervalMinutes?: number;
    },
  ) {
    const db = getDb();
    const topic = await storage.getTopic(db, ctx, id);
    if (!topic) throw new BadRequestException("topic not found");
    const type = body.type ?? "rss";
    const config = body.config ?? ({} as SourceConfig);
    const err = validateSourceConfig(type, config);
    if (err) throw new BadRequestException(err);
    const source = await storage.findOrCreateSource(db, {
      type,
      name: body.name?.trim() || String(config.target),
      platform: PLATFORM_BY_TYPE[type] ?? type,
      config: config as unknown as Record<string, unknown>,
      intervalMinutes: body.intervalMinutes,
    });
    await storage.linkTopicSource(db, topic.id, source.id);
    return source;
  }
}
