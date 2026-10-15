/**
 * @agentic-news/shared —— 全仓共享类型与接口约定。
 * 架构依据：docs/architecture.md（Step 3 adapter 约定 / Step 4 排序 / Step 5 数据模型）
 */

/** 来源类型：一期四种 adapter */
export type SourceAdapterType = "rss" | "web" | "x" | "api-upload";

/** 拉取型 adapter 的来源配置（存 sources.config） */
export interface SourceConfig {
  /** rss: feed 地址；web: 列表页或站点地址；x: 用户名（不带 @） */
  target: string;
  /** 采集间隔（分钟），省略用主题/来源默认 */
  intervalMinutes?: number;
  /** x 专用：单个来源每轮最多拉取条数 */
  maxItems?: number;
  [key: string]: unknown;
}

/**
 * RawItem —— 所有 adapter 输出、清洗管线消费的统一原始条目格式（Step 3）。
 * dedupeKey 是全局去重键：优先用来源侧外部 ID，否则用规范化 URL。
 */
export interface RawItem {
  sourceType: SourceAdapterType;
  /** 来源名（公司名或大 V 名），如 "OpenAI"、"Andrej Karpathy" */
  sourceName: string;
  /** 来源平台，如 "官方 Blog"、"X"、"公众号"、"API 上传" */
  platform: string;
  title: string;
  url: string;
  content: string;
  author?: string;
  publishedAt: string; // ISO 8601
  /** 来源侧外部 ID（RSS guid / X tweet id 等），可空 */
  externalId?: string;
  dedupeKey: string;
  /** api-upload 专用：上传者租户与用户，用于追溯（数据本身仍是公共的，见 Step 3 数据口径） */
  uploadedBy?: { tenantId: string; userId: string };
}

/** 来源 adapter 统一接口：collector 内核只认识这个接口（Step 3） */
export interface SourceAdapter {
  readonly type: SourceAdapterType;
  /** 校验来源配置是否合法，不合法抛错或返回错误信息 */
  validate(config: SourceConfig): { ok: true } | { ok: false; error: string };
  /**
   * 从游标处增量抓取。
   * @param config 来源配置
   * @param cursor 上轮游标（adapter 自定义语义，如 lastSeenId / since 时间），首次为 null
   * @returns 本轮新条目与新游标
   */
  fetch(
    config: SourceConfig,
    cursor: string | null,
  ): Promise<{ items: RawItem[]; nextCursor: string | null }>;
}

/** 清洗后的内容（对应 items 表的核心字段） */
export interface CleanedItem {
  id: string;
  sourceId: string;
  title: string;
  url: string;
  /** 小白版摘要 */
  summaryEasy: string;
  /** 进阶版摘要 */
  summaryPro: string;
  tags: string[];
  /** 重要度 0-100，cleaner 给出，参与规则排序 */
  importance: number;
  embedding: number[];
  /** embedding 模型版本标识（如 "local-hash-v1"、"text-embedding-3-small"） */
  embeddingModel: string;
  publishedAt: string;
}

/** 用户身份（原型三种身份，决定资讯深浅与初始权重） */
export type Identity = "beginner" | "developer" | "industry";

/** 反馈动作（Step 4：兴趣向量与权重更新的信号） */
export type FeedbackAction = "open" | "save" | "less";

/** 队列名（BullMQ） */
export const QUEUES = {
  /** 原始条目待清洗：collector / ingest → cleaner */
  rawItems: "raw-items",
} as const;

/** 队列任务载荷：引用 raw_items 行，避免大对象进队列 */
export interface RawItemJob {
  rawItemId: string;
}

/** 排序权重（Step 4，可配置、可按租户覆盖） */
export interface RankWeights {
  /** 向量相似度权重 w1 */
  vector: number;
  /** 规则分权重 w2 */
  rule: number;
}

export const DEFAULT_RANK_WEIGHTS: RankWeights = { vector: 0.6, rule: 0.4 };

export * from "./embed";

/** 生成去重键：有外部 ID 用 来源类型+外部ID，否则用规范化 URL */
export function makeDedupeKey(
  sourceType: SourceAdapterType,
  externalId: string | undefined,
  url: string,
): string {
  if (externalId) return `${sourceType}:${externalId}`;
  try {
    const u = new URL(url);
    u.hash = "";
    u.searchParams.delete("utm_source");
    u.searchParams.delete("utm_medium");
    u.searchParams.delete("utm_campaign");
    return `url:${u.toString()}`;
  } catch {
    return `url:${url}`;
  }
}
