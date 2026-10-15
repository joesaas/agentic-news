"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, clearSession, getTenantId, getToken, setTenantId } from "../lib/api";

interface TenantInfo {
  id: string;
  name: string;
  role: string;
}

export function Nav() {
  const [tenants, setTenants] = useState<TenantInfo[]>([]);
  const [current, setCurrent] = useState<string>("");

  useEffect(() => {
    if (!getToken()) return;
    api<{ tenants: TenantInfo[] }>("/auth/me", { tenant: false })
      .then((me) => {
        setTenants(me.tenants);
        setCurrent(getTenantId() ?? me.tenants[0]?.id ?? "");
      })
      .catch(() => undefined);
  }, []);

  const loggedIn = typeof window !== "undefined" && !!getToken();

  return (
    <header className="topbar">
      <Link href="/" className="logo">
        agentic<span>-news</span>
      </Link>
      <nav>
        <Link href="/">今日资讯</Link>
        <Link href="/topics">我的主题</Link>
        <Link href="/settings">个性化设置</Link>
      </nav>
      <div className="spacer" />
      {tenants.length > 0 && (
        <select
          value={current}
          style={{ width: "auto" }}
          onChange={(e) => {
            setTenantId(e.target.value);
            setCurrent(e.target.value);
            window.location.reload();
          }}
        >
          {tenants.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      )}
      {loggedIn ? (
        <button
          className="btn secondary"
          onClick={() => {
            clearSession();
            window.location.href = "/login";
          }}
        >
          退出
        </button>
      ) : (
        <Link href="/login" className="btn secondary" style={{ padding: "8px 14px" }}>
          登录
        </Link>
      )}
    </header>
  );
}
