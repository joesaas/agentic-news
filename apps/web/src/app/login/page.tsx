"use client";

import { useState } from "react";
import { api, setSession } from "../../lib/api";

export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const path = mode === "login" ? "/auth/login" : "/auth/register";
      const body =
        mode === "login" ? { email, password } : { email, password, name };
      const res = await api<{ token: string; tenantId: string | null }>(path, {
        method: "POST",
        body,
        tenant: false,
        auth: false,
      });
      setSession(res.token, res.tenantId);
      window.location.href = "/";
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ maxWidth: 420, margin: "40px auto" }}>
      <h1>{mode === "login" ? "登录" : "注册"}</h1>
      {mode === "register" && (
        <>
          <label>昵称</label>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </>
      )}
      <label>邮箱</label>
      <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" />
      <label>密码（至少 8 位）</label>
      <input
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        type="password"
        onKeyDown={(e) => e.key === "Enter" && void submit()}
      />
      {error && <p className="error">{error}</p>}
      <div className="row" style={{ marginTop: 16 }}>
        <button className="btn" disabled={busy} onClick={() => void submit()}>
          {mode === "login" ? "登录" : "注册并创建个人空间"}
        </button>
        <button
          className="btn secondary"
          onClick={() => setMode(mode === "login" ? "register" : "login")}
        >
          {mode === "login" ? "去注册" : "去登录"}
        </button>
      </div>
    </div>
  );
}
