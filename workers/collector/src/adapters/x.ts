import {
  makeDedupeKey,
  type RawItem,
  type SourceAdapter,
  type SourceConfig,
} from "@agentic-news/shared";

interface XTweet {
  id: string;
  text: string;
  created_at?: string;
  author_id?: string;
}

/**
 * X adapter：官方 API v2 按量付费（Step 7 成本闸门）。
 * - 需要应用级 Bearer Token（X_BEARER_TOKEN）；未配置时抛错，由内核记为“未启用”并跳过。
 * - 游标 = since_id；API 本身保证同一帖同日重复读取不重复计费，结果再经全局 dedupeKey 兜底。
 * - target 为用户名（不带 @）。
 */
export class XAdapter implements SourceAdapter {
  readonly type = "x" as const;

  constructor(private bearerToken: string | undefined) {}

  validate(config: SourceConfig) {
    if (!config.target || config.target.startsWith("http"))
      return { ok: false, error: "x target should be a username (without @)" } as const;
    return { ok: true } as const;
  }

  private async api<T>(path: string): Promise<T> {
    if (!this.bearerToken)
      throw new Error("X_BEARER_TOKEN not configured; X adapter disabled");
    const res = await fetch(`https://api.x.com/2${path}`, {
      headers: { authorization: `Bearer ${this.bearerToken}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`X API ${path} -> ${res.status}`);
    return (await res.json()) as T;
  }

  async fetch(config: SourceConfig, cursor: string | null) {
    const username = config.target.replace(/^@/, "");
    const user = await this.api<{ data?: { id: string; name: string } }>(
      `/users/by/username/${encodeURIComponent(username)}`,
    );
    if (!user.data) throw new Error(`X user not found: ${username}`);
    const max = Math.min(50, Math.max(1, Number(config.maxItems ?? 10)));
    const params = new URLSearchParams({
      max_results: String(Math.max(5, max)),
      "tweet.fields": "created_at,author_id",
      exclude: "retweets,replies",
    });
    if (cursor) params.set("since_id", cursor);
    const timeline = await this.api<{ data?: XTweet[] }>(
      `/users/${user.data.id}/tweets?${params.toString()}`,
    );
    const tweets = timeline.data ?? [];
    const items: RawItem[] = tweets.map((t) => ({
      sourceType: "x" as const,
      sourceName: user.data!.name,
      platform: "X",
      title: t.text.split("\n")[0].slice(0, 120),
      url: `https://x.com/${username}/status/${t.id}`,
      content: t.text,
      author: username,
      publishedAt: t.created_at ?? new Date().toISOString(),
      externalId: t.id,
      dedupeKey: makeDedupeKey("x", t.id, `https://x.com/${username}/status/${t.id}`),
    }));
    const maxId = tweets.reduce<string | null>(
      (acc, t) => (acc === null || BigInt(t.id) > BigInt(acc) ? t.id : acc),
      cursor,
    );
    return { items, nextCursor: maxId };
  }
}
