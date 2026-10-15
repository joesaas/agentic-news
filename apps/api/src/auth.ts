import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  ForbiddenException,
  createParamDecorator,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import * as jwt from "jsonwebtoken";
import { createHash } from "crypto";
import type { TenantCtx } from "@agentic-news/storage";
import * as storage from "@agentic-news/storage";
import { config } from "./config";
import { getDb } from "./providers";

export interface AuthedRequest {
  user: { id: string; email: string };
  ctx?: TenantCtx;
  headers: Record<string, string | string[] | undefined>;
  [key: string]: unknown;
}

export function signToken(user: { id: string; email: string }): string {
  return jwt.sign({ sub: user.id, email: user.email }, config.jwtSecret, {
    expiresIn: "7d",
  });
}

export function hashApiKey(plain: string): string {
  return createHash("sha256").update(plain).digest("hex");
}

const PUBLIC_KEY = "isPublic";
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/** 登录态守卫：除 @Public 外所有接口都要带 Bearer JWT */
@Injectable()
export class JwtGuard implements CanActivate {
  constructor(private reflector: Reflector) {}
  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers["authorization"];
    const token =
      typeof header === "string" && header.startsWith("Bearer ")
        ? header.slice("Bearer ".length)
        : null;
    if (!token) throw new UnauthorizedException("missing bearer token");
    try {
      const payload = jwt.verify(token, config.jwtSecret) as { sub: string; email: string };
      req.user = { id: payload.sub, email: payload.email };
      return true;
    } catch {
      throw new UnauthorizedException("invalid token");
    }
  }
}

/**
 * 租户守卫：租户只从 X-Tenant-Id + 成员关系推导（Step 4），
 * 前端传的 tenantId 不是成员就 403 —— 不信任前端传参。
 */
@Injectable()
export class TenantGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const tenantId = req.headers["x-tenant-id"];
    if (typeof tenantId !== "string" || !tenantId) {
      throw new ForbiddenException("missing X-Tenant-Id header");
    }
    if (!req.user) throw new UnauthorizedException();
    const ctx: TenantCtx = { tenantId, userId: req.user.id };
    const member = await storage.getMembership(getDb(), ctx);
    if (!member) throw new ForbiddenException("not a member of this tenant");
    req.ctx = ctx;
    return true;
  }
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) =>
    ctx.switchToHttp().getRequest<AuthedRequest>().user,
);

export const CurrentCtx = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) =>
    ctx.switchToHttp().getRequest<AuthedRequest>().ctx as TenantCtx,
);
