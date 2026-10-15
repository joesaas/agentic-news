/** 极简 API 客户端：token 与 tenantId 存 localStorage，请求头按 API 约定注入。 */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem("an_token");
}

export function getTenantId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem("an_tenant");
}

export function setSession(token: string, tenantId: string | null) {
  window.localStorage.setItem("an_token", token);
  if (tenantId) window.localStorage.setItem("an_tenant", tenantId);
}

export function setTenantId(tenantId: string) {
  window.localStorage.setItem("an_tenant", tenantId);
}

export function clearSession() {
  window.localStorage.removeItem("an_token");
  window.localStorage.removeItem("an_tenant");
}

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; tenant?: boolean; auth?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.auth !== false) {
    const token = getToken();
    if (token) headers["authorization"] = `Bearer ${token}`;
  }
  if (options.tenant !== false) {
    const tenantId = getTenantId();
    if (tenantId) headers["x-tenant-id"] = tenantId;
  }
  const res = await fetch(`${API_URL}/api${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

export interface FeedItem {
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
  reason: string;
}

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 1) return "刚刚";
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}
