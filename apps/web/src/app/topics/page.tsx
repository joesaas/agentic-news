"use client";

import { useEffect, useState } from "react";
import { api } from "../../lib/api";

interface Source {
  id: string;
  type: string;
  name: string;
  platform: string;
  config: { target?: string };
}
interface Topic {
  id: string;
  title: string;
  keywords: string[];
  sources: Source[];
}

export default function TopicsPage() {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [title, setTitle] = useState("");
  const [keywords, setKeywords] = useState("");
  const [error, setError] = useState("");
  const [srcForms, setSrcForms] = useState<
    Record<string, { type: string; target: string; name: string }>
  >({});

  async function load() {
    try {
      setTopics(await api<Topic[]>("/topics"));
    } catch (e) {
      setError(String((e as Error).message ?? e));
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function createTopic() {
    if (!title.trim()) return;
    await api("/topics", {
      method: "POST",
      body: {
        title: title.trim(),
        keywords: keywords.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
      },
    });
    setTitle("");
    setKeywords("");
    void load();
  }

  async function attachSource(topicId: string) {
    const form = srcForms[topicId] ?? { type: "rss", target: "", name: "" };
    if (!form.target.trim()) return;
    await api(`/topics/${topicId}/sources`, {
      method: "POST",
      body: {
        type: form.type,
        name: form.name || undefined,
        config: { target: form.target.trim() },
      },
    });
    void load();
  }

  async function removeTopic(id: string) {
    await api(`/topics/${id}`, { method: "DELETE" });
    void load();
  }

  return (
    <div>
      <h1>我的主题</h1>
      {error && <p className="error">{error}</p>}
      <div className="card">
        <label>新主题（比如：大模型、AI Agent、DeFi）</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
        <label>关键词（逗号分隔，帮系统认准这个主题）</label>
        <input value={keywords} onChange={(e) => setKeywords(e.target.value)} />
        <div style={{ marginTop: 14 }}>
          <button className="btn" onClick={() => void createTopic()}>
            添加主题
          </button>
        </div>
      </div>

      {topics.map((topic) => {
        const form = srcForms[topic.id] ?? { type: "rss", target: "", name: "" };
        return (
          <div className="card" key={topic.id}>
            <div className="row">
              <strong className="grow">{topic.title}</strong>
              <button className="icon-btn" onClick={() => void removeTopic(topic.id)}>
                删除主题
              </button>
            </div>
            <div style={{ margin: "6px 0" }}>
              {(topic.keywords ?? []).map((k) => (
                <span className="tag" key={k}>
                  {k}
                </span>
              ))}
            </div>
            <p className="muted">
              已挂来源：
              {topic.sources.length === 0
                ? " 无（collector 不会为这个主题抓取）"
                : ""}
            </p>
            {topic.sources.map((s) => (
              <p className="muted" key={s.id}>
                · {s.name}（{s.type}）{s.config?.target}
              </p>
            ))}
            <div className="row" style={{ marginTop: 10 }}>
              <select
                style={{ width: 110 }}
                value={form.type}
                onChange={(e) =>
                  setSrcForms({ ...srcForms, [topic.id]: { ...form, type: e.target.value } })
                }
              >
                <option value="rss">RSS</option>
                <option value="web">网页</option>
                <option value="x">X 用户</option>
              </select>
              <input
                className="grow"
                placeholder={
                  form.type === "x" ? "用户名，如 karpathy" : "来源地址 URL"
                }
                value={form.target}
                onChange={(e) =>
                  setSrcForms({
                    ...srcForms,
                    [topic.id]: { ...form, target: e.target.value },
                  })
                }
              />
              <button className="btn" onClick={() => void attachSource(topic.id)}>
                挂来源
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
