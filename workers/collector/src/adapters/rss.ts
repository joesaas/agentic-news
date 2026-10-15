import Parser from "rss-parser";
import {
  makeDedupeKey,
  type RawItem,
  type SourceAdapter,
  type SourceConfig,
} from "@agentic-news/shared";

type FeedItem = {
  title?: string;
  link?: string;
  guid?: string;
  creator?: string;
  content?: string;
  contentSnippet?: string;
  isoDate?: string;
  pubDate?: string;
};

/** RSS/官网 adapter：标准 feed 拉取，游标 = 已见条目的最新发布时间 */
export class RssAdapter implements SourceAdapter {
  readonly type = "rss" as const;
  private parser = new Parser<unknown, FeedItem>();

  validate(config: SourceConfig) {
    try {
      new URL(config.target);
      return { ok: true } as const;
    } catch {
      return { ok: false, error: "rss target must be a feed URL" } as const;
    }
  }

  async fetch(config: SourceConfig, cursor: string | null) {
    const feed = await this.parser.parseURL(config.target);
    const since = cursor ? new Date(cursor).getTime() : 0;
    const items: RawItem[] = [];
    let maxSeen = since;
    for (const entry of feed.items ?? []) {
      const published = entry.isoDate ?? entry.pubDate ?? new Date().toISOString();
      const ts = new Date(published).getTime();
      if (Number.isFinite(ts)) {
        if (ts <= since && cursor) continue;
        maxSeen = Math.max(maxSeen, ts);
      }
      const url = entry.link ?? config.target;
      items.push({
        sourceType: "rss",
        sourceName: feed.title ?? config.target,
        platform: "官方 Blog",
        title: entry.title ?? "(untitled)",
        url,
        content: entry.content ?? entry.contentSnippet ?? "",
        author: entry.creator,
        publishedAt: new Date(published).toISOString(),
        externalId: entry.guid ?? entry.link,
        dedupeKey: makeDedupeKey("rss", entry.guid ?? entry.link, url),
      });
    }
    return {
      items,
      nextCursor: maxSeen ? new Date(maxSeen).toISOString() : cursor,
    };
  }
}
