import { Body, Controller, Get, Patch, UseGuards } from "@nestjs/common";
import * as storage from "@agentic-news/storage";
import type { TenantCtx } from "@agentic-news/storage";
import { CurrentCtx, TenantGuard } from "./auth";
import { getDb } from "./providers";

@Controller("profile")
@UseGuards(TenantGuard)
export class ProfileController {
  @Get()
  async get(@CurrentCtx() ctx: TenantCtx) {
    const profile = await storage.getProfile(getDb(), ctx);
    return (
      profile ?? {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        identity: "beginner",
        depth: "easy",
        pushTime: "08:00",
        filters: {},
      }
    );
  }

  @Patch()
  async patch(
    @CurrentCtx() ctx: TenantCtx,
    @Body()
    body: Partial<{
      identity: string;
      depth: string;
      pushTime: string;
      filters: Record<string, unknown>;
    }>,
  ) {
    const patch: Record<string, unknown> = {};
    if (body.identity) patch.identity = body.identity;
    if (body.depth) patch.depth = body.depth;
    if (body.pushTime) patch.pushTime = body.pushTime;
    if (body.filters) patch.filters = body.filters;
    return storage.upsertProfile(getDb(), ctx, patch);
  }
}
