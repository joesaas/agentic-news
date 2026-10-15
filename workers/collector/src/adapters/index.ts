import type { SourceAdapter, SourceAdapterType } from "@agentic-news/shared";
import { RssAdapter } from "./rss";
import { WebAdapter } from "./web";
import { XAdapter } from "./x";

/**
 * adapter 注册表（Step 3）：一期 rss / web / x 三个拉取 adapter。
 * api-upload 是推送型，入口在 apps/api 的 ingest 模块，不走调度，所以不在此注册；
 * 新增拉取来源 = 新写一个 adapter 并在此登记，内核与 cleaner 不动。
 */
export function createAdapters(env: NodeJS.ProcessEnv): Map<SourceAdapterType, SourceAdapter> {
  return new Map<SourceAdapterType, SourceAdapter>([
    ["rss", new RssAdapter()],
    ["web", new WebAdapter()],
    ["x", new XAdapter(env.X_BEARER_TOKEN)],
  ]);
}
