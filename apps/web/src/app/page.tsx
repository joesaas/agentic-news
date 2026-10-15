"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, getToken, timeAgo, type FeedItem } from "../lib/api";

export default function FeedPage() {
  const router = useRouter();
  const [items, setItems] = useState<FeedItem[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    api<{ items: FeedItem[] }>("/feed?limit=15")
      .then((data) => setItems(data.items))
      .catch((e) => setError(String(e.message ?? e)))
      .finally(() => setLoading(false));
  }, [router]);

  async function feedback(itemId: string, action: "save" | "less") {
    try {
      await api("/feedback", { method: "POST", body: { itemId, action } });
      if (action === "less")
        setItems((prev) => prev.filter((i) => i.id !== itemId));
    } catch {
      // 反馈失败不打断阅读
    }
  }

  if (loading) return <p className="muted">正在按你的口味排序…</p>;
  if (error) return <p className="error">加载失败：{error}</p>;

  return (
    <div>
      <h1>今日资讯</h1>
      {items.length === 0 && (
        <div className="card">
          <p>还没有内容进池。先去给主题挂上来源，collector 抓回来、cleaner 洗完就会出现在这里。</p>
          <button className="btn" onClick={() => router.push("/topics")}>
            去设置主题
          </button>
        </div>
      )}
      {items.map((item, i) => (
        <div
          key={item.id}
          className="feed-item"
          onClick={() => router.push(`/item/${item.id}`)}
        >
          <div className="idx">{String(i + 1).padStart(2, "0")}</div>
          <div className="body">
            <div className="src">
              {item.sourceName} · {item.platform}
            </div>
            <div className="ttl">{item.title}</div>
          </div>
          <div className="acts" onClick={(e) => e.stopPropagation()}>
            <button className="icon-btn" onClick={() => feedback(item.id, "save")}>
              收藏
            </button>
            <button className="icon-btn" onClick={() => feedback(item.id, "less")}>
              少推
            </button>
          </div>
          <div className="time">{timeAgo(item.publishedAt)}</div>
        </div>
      ))}
    </div>
  );
}
