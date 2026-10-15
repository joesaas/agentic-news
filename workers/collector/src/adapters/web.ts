import {
  makeDedupeKey,
  type RawItem,
  type SourceAdapter,
  type SourceConfig,
} from "@agentic-news/shared";

/** 极简 HTML 提取（无第三方依赖）：取 title / meta description / 正文文本。 */
export function extractFromHtml(html: string, pageUrl: string) {
  const title =
    html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ??
    html.match(/<h1[^>]*>([^<]+)<\/h1>/i)?.[1]?.trim() ??
    pageUrl;
  const description =
    html.match(
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
    )?.[1] ??
    html.match(
      /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
    )?.[1] ??
    "";
  const bodyText = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { title, description, content: bodyText.slice(0, 20_000) };
}

/** 从列表页里粗略提取同域文章链接 */
export function extractArticleLinks(html: string, pageUrl: string): string[] {
  const base = new URL(pageUrl);
  const links = new Set<string>();
  for (const m of html.matchAll(/href=["']([^"']+)["']/gi)) {
    try {
      const u = new URL(m[1], pageUrl);
      if (u.hostname !== base.hostname) continue;
      if (/\.(css|js|png|jpe?g|svg|ico|xml|json)$/i.test(u.pathname)) continue;
      if (u.pathname === base.pathname) continue;
      links.add(u.toString());
    } catch {
      // 坏链接跳过
    }
  }
  return [...links];
}

/**
 * 网页 adapter：target 是单篇文章页 → 直接产出一条；
 * 若正文太短像列表页 → 提取站内链接，逐篇抓取（最多 maxItems 篇）。
 * 游标 = 已抓 URL 集合的哈希串（只存最近 200 个 URL 的尾巴，靠 dedupeKey 兜底防重）。
 */
export class WebAdapter implements SourceAdapter {
  readonly type = "web" as const;

  validate(config: SourceConfig) {
    try {
      new URL(config.target);
      return { ok: true } as const;
    } catch {
      return { ok: false, error: "web target must be a URL" } as const;
    }
  }

  private async fetchPage(url: string): Promise<string> {
    const res = await fetch(url, {
      headers: { "user-agent": "agentic-news-collector/0.1" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
    return res.text();
  }

  async fetch(config: SourceConfig, cursor: string | null) {
    const maxItems = Number(config.maxItems ?? 10);
    const seen = new Set((cursor ?? "").split("\n").filter(Boolean));
    const html = await this.fetchPage(config.target);
    const first = extractFromHtml(html, config.target);

    const urls: string[] = [];
    if (first.content.length >= 800) {
      urls.push(config.target);
    } else {
      for (const link of extractArticleLinks(html, config.target)) {
        if (!seen.has(link)) urls.push(link);
        if (urls.length >= maxItems) break;
      }
    }

    const items: RawItem[] = [];
    const newSeen = [...seen];
    for (const url of urls) {
      try {
        const pageHtml = url === config.target ? html : await this.fetchPage(url);
        const page = extractFromHtml(pageHtml, url);
        if (page.content.length < 200) continue;
        items.push({
          sourceType: "web",
          sourceName: new URL(config.target).hostname,
          platform: "网页",
          title: page.title,
          url,
          content: page.content,
          publishedAt: new Date().toISOString(),
          dedupeKey: makeDedupeKey("web", undefined, url),
        });
        newSeen.push(url);
      } catch {
        // 单篇失败不影响整轮
      }
    }
    return { items, nextCursor: newSeen.slice(-200).join("\n") || cursor };
  }
}
