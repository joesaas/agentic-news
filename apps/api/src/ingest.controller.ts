import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { randomBytes } from "crypto";
import {
  makeDedupeKey,
  type RawItem,
  type RawItemJob,
} from "@agentic-news/shared";
import * as storage from "@agentic-news/storage";
import type { TenantCtx } from "@agentic-news/storage";
import { CurrentCtx, Public, TenantGuard, hashApiKey } from "./auth";
import { getDb, getRawQueue } from "./providers";

/** API Key 管理（JWT + 租户守卫） */
@Controller("api-keys")
@UseGuards(TenantGuard)
export class ApiKeysController {
  @Get()
  async list(@CurrentCtx() ctx: TenantCtx) {
    return storage.listApiKeys(getDb(), ctx);
  }

  /** 创建 Key：明文只在这一次响应里出现，库里只存 sha256（Step 7） */
  @Post()
  async create(@CurrentCtx() ctx: TenantCtx, @Body() body: { name?: string }) {
    const plain = `agk_${randomBytes(24).toString("hex")}`;
    const row = await storage.createApiKeyRow(getDb(), {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      name: body.name?.trim() || "default",
      keyHash: hashApiKey(plain),
      prefix: plain.slice(0, 8),
    });
    return { id: row.id, name: row.name, key: plain, prefix: row.prefix };
  }
}

interface IncomingItem {
  title: string;
  url?: string;
  content: string;
  author?: string;
  publishedAt?: string;
  externalId?: string;
}

/**
 * API 上传入口（Step 3）：放在 API 应用、统一鉴权；
 * 用 X-API-Key（租户级）访问，校验后打租户标记并转发清洗队列。
 * 数据口径：上传内容默认公共、进全局共享池（li 拍板），过 cleaner 质量门后才可见。
 */
@Controller("ingest")
export class IngestController {
  @Public()
  @Post("items")
  async upload(
    @Req() req: { headers: Record<string, string | string[] | undefined> },
    @Body() body: { sourceName?: string; platform?: string; items?: IncomingItem[] },
  ) {
    const header = req.headers["x-api-key"];
    if (typeof header !== "string" || !header)
      throw new UnauthorizedException("missing X-API-Key");
    const db = getDb();
    const keyRow = await storage.findActiveApiKeyByHash(db, hashApiKey(header));
    if (!keyRow) throw new UnauthorizedException("invalid api key");
    void storage.touchApiKey(db, keyRow.id);

    const incoming = body.items ?? [];
    if (incoming.length === 0) throw new BadRequestException("items required");
    if (incoming.length > 100) throw new BadRequestException("batch too large (max 100)");

    const source = await storage.findOrCreateSource(db, {
      type: "api-upload",
      name: body.sourceName?.trim() || "API 上传",
      platform: body.platform?.trim() || "API 上传",
      config: { target: `tenant:${keyRow.tenantId}` },
    });

    const queue = getRawQueue();
    let accepted = 0;
    let duplicated = 0;
    for (const inc of incoming) {
      if (!inc.title || !inc.content) continue;
      const url = inc.url ?? "";
      const raw: RawItem = {
        sourceType: "api-upload",
        sourceName: source.name,
        platform: source.platform,
        title: inc.title,
        url,
        content: inc.content,
        author: inc.author,
        publishedAt: inc.publishedAt ?? new Date().toISOString(),
        externalId: inc.externalId,
        dedupeKey: makeDedupeKey("api-upload", inc.externalId, url || inc.title),
        uploadedBy: { tenantId: keyRow.tenantId, userId: keyRow.userId },
      };
      const inserted = await storage.insertRawItem(db, { sourceId: source.id, raw });
      if (!inserted) {
        duplicated++;
        continue;
      }
      const job: RawItemJob = { rawItemId: inserted.id };
      await queue.add("clean", job, {
        jobId: inserted.id,
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: true,
      });
      accepted++;
    }
    await storage.recordUsage(db, {
      tenantId: keyRow.tenantId,
      kind: "uploads",
      amount: accepted,
    });
    return { accepted, duplicated };
  }
}
