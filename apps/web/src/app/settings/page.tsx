"use client";

import { useEffect, useState } from "react";
import { api } from "../../lib/api";

interface Profile {
  identity: string;
  depth: string;
  pushTime: string;
  filters: { blockedKeywords?: string[] };
}
interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

const IDENTITIES = [
  { value: "beginner", label: "小白用户" },
  { value: "developer", label: "开发者" },
  { value: "industry", label: "关注行业的人" },
];

export default function SettingsPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [newKey, setNewKey] = useState("");
  const [keyName, setKeyName] = useState("");
  const [error, setError] = useState("");
  const [savedTip, setSavedTip] = useState("");

  useEffect(() => {
    api<Profile>("/profile").then(setProfile).catch((e) => setError(String(e)));
    api<ApiKeyRow[]>("/api-keys").then(setKeys).catch(() => undefined);
  }, []);

  async function save(patch: Partial<Profile>) {
    if (!profile) return;
    const next = { ...profile, ...patch };
    setProfile(next);
    try {
      await api("/profile", { method: "PATCH", body: patch });
      setSavedTip("已保存");
      setTimeout(() => setSavedTip(""), 1500);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    }
  }

  async function createKey() {
    const res = await api<{ key: string }>("/api-keys", {
      method: "POST",
      body: { name: keyName || "default" },
    });
    setNewKey(res.key);
    setKeys(await api<ApiKeyRow[]>("/api-keys"));
  }

  if (!profile) return <p className="muted">加载中…</p>;

  return (
    <div>
      <h1>个性化设置</h1>
      {error && <p className="error">{error}</p>}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>我是谁（身份）</h2>
        <div className="row">
          {IDENTITIES.map((it) => (
            <button
              key={it.value}
              className={profile.identity === it.value ? "btn" : "btn secondary"}
              onClick={() =>
                void save({
                  identity: it.value,
                  depth: it.value === "beginner" ? "easy" : "pro",
                })
              }
            >
              {it.label}
            </button>
          ))}
        </div>
        <label>摘要深浅</label>
        <div className="row">
          <button
            className={profile.depth === "easy" ? "btn" : "btn secondary"}
            onClick={() => void save({ depth: "easy" })}
          >
            小白版
          </button>
          <button
            className={profile.depth === "pro" ? "btn" : "btn secondary"}
            onClick={() => void save({ depth: "pro" })}
          >
            进阶版
          </button>
        </div>
        <label>每日汇总时间（一期只站内展示）</label>
        <input
          type="time"
          value={profile.pushTime}
          onChange={(e) => void save({ pushTime: e.target.value })}
          style={{ width: 160 }}
        />
        <label>不想看到的关键词（逗号分隔）</label>
        <input
          defaultValue={(profile.filters.blockedKeywords ?? []).join(", ")}
          onBlur={(e) =>
            void save({
              filters: {
                ...profile.filters,
                blockedKeywords: e.target.value
                  .split(/[,，]/)
                  .map((s) => s.trim())
                  .filter(Boolean),
              },
            })
          }
        />
        {savedTip && <p className="muted">{savedTip}</p>}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>API 上传 Key</h2>
        <p className="muted">
          用这个 Key 调 POST /api/ingest/items 上传数据（请求头 X-API-Key）。
          上传内容默认公共、进全局共享池，过质量门后所有用户可见。明文只在创建时显示一次。
        </p>
        <div className="row">
          <input
            className="grow"
            placeholder="Key 名称"
            value={keyName}
            onChange={(e) => setKeyName(e.target.value)}
          />
          <button className="btn" onClick={() => void createKey()}>
            创建 Key
          </button>
        </div>
        {newKey && (
          <>
            <label>新 Key（请立即保存）</label>
            <code className="key">{newKey}</code>
          </>
        )}
        {keys.map((k) => (
          <p className="muted" key={k.id}>
            · {k.name}（{k.prefix}…）创建于 {new Date(k.createdAt).toLocaleDateString()}
            {k.lastUsedAt ? `，最近使用 ${new Date(k.lastUsedAt).toLocaleString()}` : ""}
          </p>
        ))}
      </div>
    </div>
  );
}
