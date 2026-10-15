/**
 * 质量门（Step 3/7）：内容进公共池前必须过这里。
 * 去重在存储层靠 dedupeKey 全局唯一完成；本模块管“值不值得进池”：
 * 正文太短、营销/垃圾特征明显的一律拒绝（尤其 API 上传来源）。
 */
import type { RawItem } from "@agentic-news/shared";

const SPAM_PATTERNS: RegExp[] = [
  /(免费领取|扫码进群|加微信|点击领取|限时优惠|赚钱项目)/,
  /(casino|赌场|博彩|代孕|刷单)/i,
  /(seo|关键词排名|网站推广服务)/i,
];

export interface QualityResult {
  ok: boolean;
  reason?: string;
}

export function checkQuality(raw: RawItem): QualityResult {
  const content = (raw.content ?? "").trim();
  if (!raw.title || raw.title.trim().length < 4)
    return { ok: false, reason: "title too short" };
  if (content.length < 50) return { ok: false, reason: "content too short" };
  const hay = `${raw.title} ${content}`;
  for (const pattern of SPAM_PATTERNS) {
    if (pattern.test(hay)) return { ok: false, reason: `spam pattern: ${pattern}` };
  }
  // 链接密度过高多为营销页
  const linkCount = (content.match(/https?:\/\//g) ?? []).length;
  if (linkCount > 10 && content.length < 2000)
    return { ok: false, reason: "link-dense content" };
  return { ok: true };
}
