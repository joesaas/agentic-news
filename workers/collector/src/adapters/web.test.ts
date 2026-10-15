import { describe, expect, it } from "vitest";
import { extractArticleLinks, extractFromHtml } from "./web";

describe("extractFromHtml", () => {
  it("提取 title 与 meta description，正文去标签", () => {
    const html = `<html><head><title> 标题A </title>
      <meta name="description" content="描述B"></head>
      <body><script>var x=1</script><p>正文 内容</p></body></html>`;
    const out = extractFromHtml(html, "https://example.com/a");
    expect(out.title).toBe("标题A");
    expect(out.description).toBe("描述B");
    expect(out.content).toContain("正文 内容");
    expect(out.content).not.toContain("var x");
  });
});

describe("extractArticleLinks", () => {
  it("只保留同域、非静态资源、非本页链接", () => {
    const html = `<a href="/posts/1">1</a><a href="https://other.com/x">x</a>
      <a href="/style.css">c</a><a href="https://example.com/blog">self</a>
      <a href="/posts/2">2</a>`;
    const links = extractArticleLinks(html, "https://example.com/blog");
    expect(links).toEqual([
      "https://example.com/posts/1",
      "https://example.com/posts/2",
    ]);
  });
});
