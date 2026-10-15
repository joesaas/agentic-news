"use client";

import { use, useEffect, useState } from "react";
import { api } from "../../../lib/api";

interface ItemDetail {
  id: string;
  title: string;
  url: string;
  summaryEasy: string;
  summaryPro: string;
  sourceName: string;
  platform: string;
  tags: string[];
  importance: number;
  publishedAt: string;
}

export default function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [item, setItem] = useState<ItemDetail | null>(null);
  const [depth, setDepth] = useState<"easy" | "pro">("easy");
  const [error, setError] = useState("");

  useEffect(() => {
    api<ItemDetail>(`/items/${id}`)
      .then((data) => {
        setItem(data);
        // 打开详情记一次 open 反馈，参与兴趣向量更新
        void api("/feedback", {
          method: "POST",
          body: { itemId: id, action: "open" },
        }).catch(() => undefined);
      })
      .catch((e) => setError(String((e as Error).message ?? e)));
  }, [id]);

  if (error) return <p className="error">{error}</p>;
  if (!item) return <p className="muted">加载中…</p>;

  return (
    <div>
      <p className="muted">
        {item.sourceName} · {item.platform} · {new Date(item.publishedAt).toLocaleString()} ·
        重要度 {item.importance}
      </p>
      <h1 style={{ lineHeight: 1.4 }}>{item.title}</h1>
      <div style={{ margin: "10px 0" }}>
        {item.tags.map((t) => (
          <span className="tag" key={t}>
            {t}
          </span>
        ))}
      </div>
      <div className="row" style={{ margin: "14px 0" }}>
        <button
          className={depth === "easy" ? "btn" : "btn secondary"}
          onClick={() => setDepth("easy")}
        >
          小白版摘要
        </button>
        <button
          className={depth === "pro" ? "btn" : "btn secondary"}
          onClick={() => setDepth("pro")}
        >
          进阶版摘要
        </button>
        <a className="btn secondary" href={item.url} target="_blank" rel="noreferrer" style={{ padding: "8px 14px" }}>
          看原文
        </a>
      </div>
      <div className="card">
        <p className="summary">{depth === "easy" ? item.summaryEasy : item.summaryPro}</p>
      </div>
    </div>
  );
}
