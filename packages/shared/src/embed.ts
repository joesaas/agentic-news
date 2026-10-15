/**
 * 本地确定性 embedding（开发/无 Key 时的兜底实现，模型名 local-hash-v1）。
 * 原理：分词后按 token 哈希散布到向量维度并按符号累加，最后 L2 归一化。
 * 语义质量远不如真实模型，但保证“向量 + 规则混合”管线在没有 LLM Key 时也能端到端跑通；
 * 接入真实 embedding 后（cleaner 侧切换 provider），历史向量需按新模型重刷。
 */
import { createHash } from "crypto";

export const LOCAL_EMBED_MODEL = "local-hash-v1";

function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  const words = lower.match(/[a-z0-9]+/g) ?? [];
  // 中文按 2-gram 切分，粗略保留语义
  const cjk = lower.match(/[一-鿿]+/g) ?? [];
  const grams: string[] = [];
  for (const seg of cjk) {
    for (let i = 0; i < seg.length - 1; i++) grams.push(seg.slice(i, i + 2));
    if (seg.length === 1) grams.push(seg);
  }
  return [...words, ...grams];
}

export function localEmbed(text: string, dim = 1536): number[] {
  const vec = new Array<number>(dim).fill(0);
  for (const token of tokenize(text)) {
    const digest = createHash("sha256").update(token).digest();
    const idx = digest.readUInt32BE(0) % dim;
    const sign = digest[4] % 2 === 0 ? 1 : -1;
    vec[idx] += sign;
  }
  return normalizeVector(vec);
}

export function normalizeVector(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  if (norm === 0) return vec;
  return vec.map((v) => v / norm);
}

/** 多个向量按权重合成一个兴趣向量（Step 4） */
export function combineVectors(
  parts: Array<{ vector: number[]; weight: number }>,
): number[] | null {
  const nonEmpty = parts.filter((p) => p.vector.length > 0 && p.weight !== 0);
  if (nonEmpty.length === 0) return null;
  const dim = nonEmpty[0].vector.length;
  const out = new Array<number>(dim).fill(0);
  for (const { vector, weight } of nonEmpty) {
    for (let i = 0; i < dim; i++) out[i] += (vector[i] ?? 0) * weight;
  }
  return normalizeVector(out);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
