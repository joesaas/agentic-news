import { describe, expect, it } from "vitest";
import type { RawItem } from "@agentic-news/shared";
import { checkQuality } from "./quality";

function raw(partial: Partial<RawItem>): RawItem {
  return {
    sourceType: "rss",
    sourceName: "OpenAI",
    platform: "官方 Blog",
    title: "OpenAI 发布新模型",
    url: "https://example.com/post",
    content: "这是一段足够长的正文内容。".repeat(10),
    publishedAt: new Date().toISOString(),
    dedupeKey: "rss:1",
    ...partial,
  };
}

describe("checkQuality", () => {
  it("正常内容通过", () => {
    expect(checkQuality(raw({})).ok).toBe(true);
  });
  it("正文太短拒绝", () => {
    expect(checkQuality(raw({ content: "短" })).ok).toBe(false);
  });
  it("营销话术拒绝", () => {
    const r = raw({ content: `${"正文".repeat(30)} 免费领取课程，加微信咨询` });
    expect(checkQuality(r).ok).toBe(false);
  });
  it("链接密度过高拒绝", () => {
    const r = raw({ content: `${"http://a.com ".repeat(12)}${"字".repeat(60)}` });
    expect(checkQuality(r).ok).toBe(false);
  });
});
