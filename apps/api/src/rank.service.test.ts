import { describe, expect, it } from "vitest";
import { combineScore, computeRuleScore } from "./rank.service";

const now = new Date("2026-10-15T12:00:00Z");

describe("computeRuleScore", () => {
  it("新鲜 + 命中主题 + 高重要度 → 接近满分", () => {
    const s = computeRuleScore({
      tags: ["LLM"],
      title: "LLM 新模型发布",
      importance: 100,
      publishedAt: now,
      topicKeywords: ["LLM"],
      now,
    });
    expect(s).toBeGreaterThan(0.95);
  });

  it("三天前的内容新鲜度明显衰减", () => {
    const fresh = computeRuleScore({
      tags: [],
      title: "x",
      importance: 50,
      publishedAt: now,
      topicKeywords: [],
      now,
    });
    const stale = computeRuleScore({
      tags: [],
      title: "x",
      importance: 50,
      publishedAt: new Date(now.getTime() - 72 * 3_600_000),
      topicKeywords: [],
      now,
    });
    expect(stale).toBeLessThan(fresh);
  });
});

describe("combineScore", () => {
  it("无兴趣向量时用主题匹配度兜底（冷启动）", () => {
    const withVec = combineScore(0.9, 0.5, 0.1);
    const cold = combineScore(null, 0.5, 0.1);
    expect(withVec).toBeGreaterThan(cold);
    expect(cold).toBeCloseTo(0.6 * 0.1 + 0.4 * 0.5, 5);
  });

  it("负相似度按 0 处理", () => {
    expect(combineScore(-0.5, 0, 0)).toBe(0);
  });
});
