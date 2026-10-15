import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  UnauthorizedException,
} from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import * as storage from "@agentic-news/storage";
import { CurrentUser, Public, signToken } from "./auth";
import { getDb } from "./providers";

@Controller()
export class AuthController {

  /** 注册：建用户 + 自动建一个个人空间（租户） */
  @Public()
  @Post("auth/register")
  async register(
    @Body() body: { email?: string; password?: string; name?: string },
  ) {
    const email = body.email?.trim().toLowerCase();
    const password = body.password ?? "";
    const name = body.name?.trim() || email?.split("@")[0] || "user";
    if (!email || !email.includes("@")) throw new BadRequestException("invalid email");
    if (password.length < 8) throw new BadRequestException("password too short (min 8)");
    const db = getDb();
    if (await storage.findUserByEmail(db, email))
      throw new BadRequestException("email already registered");
    const user = await storage.createUser(db, {
      email,
      name,
      passwordHash: await bcrypt.hash(password, 10),
    });
    const tenant = await storage.createTenant(db, {
      name: `${name} 的空间`,
      ownerUserId: user.id,
    });
    return {
      token: signToken(user),
      user: { id: user.id, email: user.email, name: user.name },
      tenantId: tenant.id,
    };
  }

  @Public()
  @Post("auth/login")
  async login(@Body() body: { email?: string; password?: string }) {
    const email = body.email?.trim().toLowerCase() ?? "";
    const db = getDb();
    const user = await storage.findUserByEmail(db, email);
    if (!user || !(await bcrypt.compare(body.password ?? "", user.passwordHash)))
      throw new UnauthorizedException("invalid credentials");
    const tenants = await storage.listUserTenants(db, user.id);
    return {
      token: signToken(user),
      user: { id: user.id, email: user.email, name: user.name },
      tenantId: tenants[0]?.tenant.id ?? null,
    };
  }

  @Get("auth/me")
  async me(@CurrentUser() user: { id: string; email: string }) {
    const db = getDb();
    const tenants = await storage.listUserTenants(db, user.id);
    return {
      user,
      tenants: tenants.map((t) => ({
        id: t.tenant.id,
        name: t.tenant.name,
        role: t.role,
      })),
    };
  }

  /** 新建空间（家庭/团队） */
  @Post("tenants")
  async createTenant(
    @CurrentUser() user: { id: string },
    @Body() body: { name?: string },
  ) {
    const name = body.name?.trim();
    if (!name) throw new BadRequestException("name required");
    const tenant = await storage.createTenant(getDb(), {
      name,
      ownerUserId: user.id,
    });
    return { id: tenant.id, name: tenant.name, role: "owner" };
  }
}
