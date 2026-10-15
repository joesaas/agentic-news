/**
 * LLM / Embedding provider 抽象（架构文档待定项 1）。
 * 默认 local：抽取式摘要 + 本地确定性向量，不需要任何 Key，整条管线可跑通。
 * 配 OPENAI_API_KEY 并把 LLM_PROVIDER/EMBEDDING_PROVIDER 设为 openai 后走真实模型。
 */
import { LOCAL_EMBED_MODEL, localEmbed } from "@agentic-news/shared";

export interface SummarizeResult {
  summaryEasy: string;
  summaryPro: string;
  tags: string[];
  importance: number; // 0-100
  /** 本次消耗的 token 估算（计量用） */
  tokens: number;
}

export interface LlmProvider {
  readonly name: string;
  summarize(input: { title: string; content: string }): Promise<SummarizeResult>;
}

export interface EmbeddingProvider {
  readonly name: string;
  readonly model: string;
  embed(text: string): Promise<{ vector: number[]; tokens: number }>;
}

// ---------------- local 实现 ----------------

const TAG_KEYWORDS: Array<[string, string[]]> = [
  ["LLM", ["llm", "大模型", "gpt", "claude", "gemini", "语言模型"]],
  ["Agent", ["agent", "智能体", "agentic"]],
  ["开源", ["开源", "open source", "github"]],
  ["融资", ["融资", "funding", "估值", "投资"]],
  ["产品发布", ["发布", "推出", "launch", "release", "上线"]],
  ["芯片", ["芯片", "gpu", "nvidia", "算力"]],
  ["机器人", ["机器人", "robot", "具身"]],
  ["Web3", ["web3", "defi", "区块链", "crypto", "链上"]],
];

export function heuristicTags(title: string, content: string): string[] {
  const hay = `${title} ${content}`.toLowerCase();
  return TAG_KEYWORDS.filter(([, kws]) => kws.some((k) => hay.includes(k))).map(
    ([tag]) => tag,
  );
}

export function heuristicImportance(title: string, content: string): number {
  const hay = `${title} ${content}`.toLowerCase();
  let score = 40;
  if (/(发布|推出|launch|release|上线|announces)/i.test(hay)) score += 20;
  if (/(融资|收购|funding|acqui)/i.test(hay)) score += 15;
  if (/(突破|首个|重大|breakthrough)/i.test(hay)) score += 10;
  if (content.length > 3000) score += 5;
  return Math.min(95, score);
}

function firstSentences(text: string, count: number, maxLen: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const sentences = clean.split(/(?<=[。！？.!?])\s*/).filter((s) => s.length > 10);
  const picked = (sentences.length ? sentences : [clean]).slice(0, count).join(" ");
  return picked.slice(0, maxLen);
}

export class LocalLlmProvider implements LlmProvider {
  readonly name = "local";
  async summarize(input: { title: string; content: string }): Promise<SummarizeResult> {
    const pro = firstSentences(input.content, 4, 600);
    const easy = firstSentences(input.content, 2, 240);
    return {
      summaryEasy: easy || input.title,
      summaryPro: pro || input.title,
      tags: heuristicTags(input.title, input.content),
      importance: heuristicImportance(input.title, input.content),
      tokens: 0,
    };
  }
}

export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly name = "local";
  readonly model = LOCAL_EMBED_MODEL;
  constructor(private dim: number) {}
  async embed(text: string) {
    return { vector: localEmbed(text, this.dim), tokens: 0 };
  }
}

// ---------------- OpenAI 实现 ----------------

export class OpenAiProvider implements LlmProvider, EmbeddingProvider {
  readonly name = "openai";
  constructor(
    private apiKey: string,
    private llmModel: string,
    readonly model: string,
  ) {}

  private async post(path: string, body: unknown): Promise<any> {
    const res = await fetch(`https://api.openai.com/v1${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`OpenAI ${path} -> ${res.status}: ${await res.text()}`);
    return res.json();
  }

  async summarize(input: { title: string; content: string }): Promise<SummarizeResult> {
    const data = await this.post("/chat/completions", {
      model: this.llmModel,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "你是资讯编辑。基于给定的标题与正文，输出 JSON：summaryEasy（给小白看，通俗，<=120字）、summaryPro（给专业读者，信息密度高，<=300字）、tags（字符串数组，<=5个）、importance（0-100整数）。只基于原文，不编造。",
        },
        {
          role: "user",
          content: `标题：${input.title}\n\n正文：${input.content.slice(0, 8000)}`,
        },
      ],
    });
    const parsed = JSON.parse(data.choices[0].message.content);
    return {
      summaryEasy: String(parsed.summaryEasy ?? ""),
      summaryPro: String(parsed.summaryPro ?? ""),
      tags: Array.isArray(parsed.tags) ? parsed.tags.map(String).slice(0, 5) : [],
      importance: Math.min(100, Math.max(0, Number(parsed.importance ?? 50))),
      tokens: Number(data.usage?.total_tokens ?? 0),
    };
  }

  async embed(text: string) {
    const data = await this.post("/embeddings", {
      model: this.model,
      input: text.slice(0, 8000),
    });
    return {
      vector: data.data[0].embedding as number[],
      tokens: Number(data.usage?.total_tokens ?? 0),
    };
  }
}

// ---------------- 工厂 ----------------

export function createProviders(env: NodeJS.ProcessEnv): {
  llm: LlmProvider;
  embedding: EmbeddingProvider;
} {
  const dim = Number(env.EMBEDDING_DIM ?? 1536);
  const key = env.OPENAI_API_KEY;
  if (key && (env.LLM_PROVIDER === "openai" || env.EMBEDDING_PROVIDER === "openai")) {
    const openai = new OpenAiProvider(
      key,
      env.LLM_MODEL ?? "gpt-4o-mini",
      env.EMBEDDING_MODEL ?? "text-embedding-3-small",
    );
    return {
      llm: env.LLM_PROVIDER === "openai" ? openai : new LocalLlmProvider(),
      embedding:
        env.EMBEDDING_PROVIDER === "openai"
          ? openai
          : new LocalEmbeddingProvider(dim),
    };
  }
  return { llm: new LocalLlmProvider(), embedding: new LocalEmbeddingProvider(dim) };
}
