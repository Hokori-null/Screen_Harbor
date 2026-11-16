import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type { Server, ServerView, Session } from "./shared";
import "@xterm/xterm/css/xterm.css";
import "./style.css";
const api = window.screenAPI;
type Tab = {
  id: string;
  serverId: string;
  sessionId: string;
  name: string;
  serverName: string;
  closed: boolean;
};
const terminals = new Map<string, { term: Terminal; fit: FitAddon }>();
const pending = new Map<string, string[]>();
const SESSION_PAGE_SIZE = 3;
function TerminalView({ tab, active }: { tab: Tab; active: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const term = new Terminal({
      fontFamily: "Cascadia Code, Consolas, monospace",
      fontSize: 14,
      cursorBlink: true,
      scrollback: 6000,
      theme: {
        background: "#0c1119",
        foreground: "#d7e1ec",
        cursor: "#77dfba",
        selectionBackground: "#285345",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(ref.current!);
    // Wheel gestures belong to local history, never remote arrow keys or
    // mouse reports (including Screen's alternate-screen mode).
    let wheelRemainder = 0;
    term.attachCustomWheelEventHandler((event) => {
      event.preventDefault();
      const rowHeight = Math.max(1, term.element!.clientHeight / term.rows);
      const lines =
        event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? event.deltaY * term.rows
          : event.deltaMode === WheelEvent.DOM_DELTA_LINE
            ? event.deltaY
            : event.deltaY / rowHeight;
      if (Math.sign(lines) !== Math.sign(wheelRemainder)) wheelRemainder = 0;
      wheelRemainder += lines;
      const wholeLines = Math.trunc(wheelRemainder);
      if (wholeLines) term.scrollLines(wholeLines);
      wheelRemainder -= wholeLines;
      return false;
    });
    terminals.set(tab.id, { term, fit });
    for (const data of pending.get(tab.id) ?? []) term.write(data);
    pending.delete(tab.id);
    const input = term.onData((data) => {
      for (let i = 0; i < data.length; i += 16384)
        void api
          .call("input", {
            serverId: tab.serverId,
            terminalId: tab.id,
            data: data.slice(i, i + 16384),
          })
          .catch(() => {});
    });
    const resize = () => {
      if (ref.current?.offsetWidth) {
        fit.fit();
        void api
          .call("resize", {
            serverId: tab.serverId,
            terminalId: tab.id,
            cols: term.cols,
            rows: term.rows,
          })
          .catch(() => {});
      }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(ref.current!);
    resize();
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true;
      if (event.ctrlKey && event.shiftKey && event.code === "KeyC") {
        void navigator.clipboard.writeText(term.getSelection());
        return false;
      }
      if (event.ctrlKey && event.shiftKey && event.code === "KeyV") {
        void navigator.clipboard.readText().then((text) => term.paste(text));
        return false;
      }
      return true;
    });
    return () => {
      observer.disconnect();
      input.dispose();
      term.dispose();
      terminals.delete(tab.id);
      pending.delete(tab.id);
    };
  }, [tab.id]);
  useEffect(() => {
    if (active) {
      const t = terminals.get(tab.id);
      t?.fit.fit();
      t?.term.focus();
    }
  }, [active]);
  return (
    <div
      className={"terminal-viewport " + (active ? "active" : "")}
      ref={ref}
    />
  );
}
function App() {
  const [servers, setServers] = useState<ServerView[]>([]),
    [selected, setSelected] = useState("");
  const [statuses, setStatuses] = useState<Record<string, string>>({}),
    [sessions, setSessions] = useState<Record<string, Session[]>>({});
  const [tabs, setTabs] = useState<Tab[]>([]),
    [active, setActive] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Server | null>(null),
    [secret, setSecret] = useState(""),
    [authServer, setAuthServer] = useState<ServerView | null>(null);
  const [nameDialog, setNameDialog] = useState<{
      serverId: string;
      session?: Session;
    } | null>(null),
    [sessionName, setSessionName] = useState("");
  const [deleteId, setDeleteId] = useState("");
  const [terminalMaximized, setTerminalMaximized] = useState(false);
  const [sessionPages, setSessionPages] = useState<Record<string, number>>({});
  const current = servers.find((s) => s.id === selected),
    connected = statuses[selected] === "connected";
  const currentSessions = sessions[selected] ?? [];
  const pageCount = Math.max(
    1,
    Math.ceil(currentSessions.length / SESSION_PAGE_SIZE),
  );
  const sessionPage = Math.min(sessionPages[selected] ?? 1, pageCount);
  const visibleSessions = currentSessions.slice(
    (sessionPage - 1) * SESSION_PAGE_SIZE,
    sessionPage * SESSION_PAGE_SIZE,
  );
  const refreshServers = async () => {
    const list = await api.call("list", {});
    setServers(list);
    setSelected((id) =>
      list.some((s) => s.id === id) ? id : (list[0]?.id ?? ""),
    );
  };
  const refresh = async (id: string) => {
    const list = await api.call("sessions", { serverId: id });
    setSessions((s) => ({ ...s, [id]: list }));
    setSessionPages((pages) => ({
      ...pages,
      [id]: Math.min(
        pages[id] ?? 1,
        Math.max(1, Math.ceil(list.length / SESSION_PAGE_SIZE)),
      ),
    }));
    return list;
  };
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(
        String(e instanceof Error ? e.message : e).replace(
          /^Error invoking remote method '[^']+': Error: /,
          "",
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void run(refreshServers);
    return api.onEvent((e) => {
      if (e.type === "status") {
        setStatuses((s) => ({ ...s, [e.serverId]: e.status }));
        if (e.status === "disconnected")
          setTabs((ts) =>
            ts.map((t) =>
              t.serverId === e.serverId ? { ...t, closed: true } : t,
            ),
          );
      } else if (e.type === "data") {
        const t = terminals.get(e.terminalId);
        if (t) t.term.write(e.data ?? "");
        else {
          const p = pending.get(e.terminalId) ?? [];
          p.push(e.data ?? "");
          if (p.length < 1024) pending.set(e.terminalId, p);
        }
      } else {
        setTabs((ts) =>
          ts.map((t) => (t.id === e.terminalId ? { ...t, closed: true } : t)),
        );
        terminals
          .get(e.terminalId)
          ?.term.writeln("\r\n\x1b[90m[连接已关闭 · 终端内容已保留]\x1b[0m");
      }
    });
  }, []);
  async function attach(server: ServerView, session: Session) {
    const existing = tabs.find(
      (t) =>
        t.serverId === server.id && t.sessionId === session.id && !t.closed,
    );
    if (existing) {
      setActive(existing.id);
      return;
    }
    const id = crypto.randomUUID();
    const tab: Tab = {
      id,
      serverId: server.id,
      sessionId: session.id,
      name: session.name,
      serverName: server.name,
      closed: false,
    };
    pending.set(id, []);
    setTabs((ts) => [...ts, tab]);
    setActive(id);
    try {
      await api.call("attach", {
        serverId: server.id,
        sessionId: session.id,
        terminalId: id,
        takeover: session.state === "Attached",
        cols: 100,
        rows: 28,
      });
      const t = terminals.get(id);
      if (t) {
        t.fit.fit();
        await api.call("resize", {
          serverId: server.id,
          terminalId: id,
          cols: t.term.cols,
          rows: t.term.rows,
        });
      }
      await refresh(server.id);
    } catch (e) {
      setTabs((ts) =>
        ts.map((t) => (t.id === id ? { ...t, closed: true } : t)),
      );
      throw e;
    }
  }
  async function connect(server: ServerView, value?: string) {
    await api.call("connect", { serverId: server.id, secret: value });
    setAuthServer(null);
    setSecret("");
    await refresh(server.id);
  }
  function startConnect(server: ServerView) {
    if (server.hasSecret) void run(() => connect(server));
    else {
      setSecret("");
      setAuthServer(server);
    }
  }
  function edit(server?: ServerView) {
    setSecret("");
    setEditing(
      server
        ? { ...server }
        : {
            id: crypto.randomUUID(),
            name: "",
            host: "",
            port: 22,
            username: "root",
            auth: "password",
            keyPath: "",
            remember: false,
          },
    );
  }
  async function closeTab(tab: Tab) {
    await api.call("close", { serverId: tab.serverId, terminalId: tab.id });
    setTabs((ts) => ts.filter((t) => t.id !== tab.id));
    if (active === tab.id)
      setActive(tabs.filter((t) => t.id !== tab.id).at(-1)?.id ?? "");
    if (statuses[tab.serverId] === "connected") await refresh(tab.serverId);
  }
  return (
    <div className={"app" + (terminalMaximized ? " terminal-maximized" : "")}>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-icon">▤</span>
          <div>
            Screen Harbor<small>REMOTE WORKSPACE</small>
          </div>
        </div>
        <div className="sidebar-heading">
          服务器 <span>{servers.length}</span>
          <button title="新增服务器" onClick={() => edit()}>
            ＋
          </button>
        </div>
        <div className="server-list">
          {servers.map((s) => (
            <button
              key={s.id}
              className={"server " + (selected === s.id ? "selected" : "")}
              onClick={() => setSelected(s.id)}
            >
              <span className={"dot " + (statuses[s.id] ?? "disconnected")} />
              <div>
                <strong>{s.name}</strong>
                <small>
                  {s.username}@{s.host}
                </small>
              </div>
              <span className="server-arrow">›</span>
            </button>
          ))}
        </div>
        <button className="add-server" onClick={() => edit()}>
          ＋ 添加服务器
        </button>
        <div className="sidebar-footer">
          <span className="secure-icon">◇</span> SSH 加密连接
          <small>远程任务，始终在线。</small>
        </div>
      </aside>
      <main>
        <header>
          <div>
            <div className="eyebrow">工作空间 / SCREEN 会话</div>
            <h1>{current?.name ?? "欢迎来到 Screen Harbor"}</h1>
            <p>
              {current
                ? `${current.username}@${current.host}:${current.port}`
                : "连接你的服务器，让每个任务都有自己的空间。"}
            </p>
          </div>
          {current && (
            <div className="header-actions">
              <span
                className={"status " + (statuses[selected] ?? "disconnected")}
              >
                {connected
                  ? "已连接"
                  : statuses[selected] === "connecting"
                    ? "连接中"
                    : "未连接"}
              </span>
              <button disabled={busy} onClick={() => edit(current)}>
                编辑
              </button>
              <button disabled={busy} onClick={() => setDeleteId(current.id)}>
                删除
              </button>
              <button
                className={connected ? "" : "primary"}
                disabled={busy}
                onClick={() =>
                  connected
                    ? void run(() =>
                        api.call("disconnect", { serverId: selected }),
                      )
                    : startConnect(current)
                }
              >
                {connected ? "断开连接" : "连接服务器"}
              </button>
            </div>
          )}
        </header>
        {error && (
          <div className="error" role="alert">
            <span>{error}</span>
            <button onClick={() => setError("")}>×</button>
          </div>
        )}
        <section className="sessions">
          <div className="section-title">
            <h2>
              会话{" "}
              <span>{connected ? (sessions[selected]?.length ?? 0) : "—"}</span>
            </h2>
            <div>
              <button
                disabled={!connected || busy}
                onClick={() => void run(() => refresh(selected))}
              >
                ↻ 刷新
              </button>
              <button
                className="primary"
                disabled={!connected || busy}
                onClick={() => {
                  setSessionName("");
                  setNameDialog({ serverId: selected });
                }}
              >
                ＋ 新建会话
              </button>
            </div>
          </div>
          {!current ? (
            <div className="empty">
              <div className="empty-glyph">⌘</div>
              <h3>从第一台服务器开始</h3>
              <p>通过 SSH 连接，集中管理你的 Screen 会话。</p>
              <button className="primary" onClick={() => edit()}>
                添加服务器
              </button>
            </div>
          ) : !connected ? (
            <div className="empty">
              <div className="empty-glyph">↗</div>
              <h3>连接后查看远程会话</h3>
              <p>支持密码与 SSH 私钥，连接断开不会结束远程任务。</p>
            </div>
          ) : !sessions[selected]?.length ? (
            <div className="empty">
              <div className="empty-glyph">▤</div>
              <h3>还没有 Screen 会话</h3>
              <p>新建一个会话，开始你的第一个任务。</p>
            </div>
          ) : (
            <div className="session-table">
              <div className="table-head">
                <span>会话名称 / 标识</span>
                <span>状态</span>
                <span>操作</span>
              </div>
              {visibleSessions.map((s) => (
                <div className="session-row" key={s.id}>
                  <div className="session-label">
                    <span className="session-icon">›_</span>
                    <div>
                      <strong>{s.name}</strong>
                      <small>{s.id}</small>
                    </div>
                  </div>
                  <span className={"pill " + s.state.toLowerCase()}>
                    {s.state === "Attached"
                      ? "已接入"
                      : s.state === "Detached"
                        ? "后台运行"
                        : s.state}
                  </span>
                  <div className="row-actions">
                    <button
                      disabled={
                        busy || !["Attached", "Detached"].includes(s.state)
                      }
                      onClick={() => void run(() => attach(current, s))}
                    >
                      {s.state === "Attached" ? "接管" : "打开终端"}
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => {
                        setSessionName(s.name);
                        setNameDialog({ serverId: selected, session: s });
                      }}
                    >
                      重命名
                    </button>
                    <button
                      className="danger-text"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await api.call("end", {
                            serverId: selected,
                            sessionId: s.id,
                          });
                          await refresh(selected);
                        })
                      }
                    >
                      结束
                    </button>
                  </div>
                </div>
              ))}
              {pageCount > 1 && (
                <nav className="session-pagination" aria-label="会话分页">
                  <span aria-live="polite">
                    共 {currentSessions.length} 个会话 · 第 {sessionPage} /{" "}
                    {pageCount} 页
                  </span>
                  <button
                    disabled={sessionPage === 1}
                    onClick={() =>
                      setSessionPages((pages) => ({
                        ...pages,
                        [selected]: sessionPage - 1,
                      }))
                    }
                  >
                    上一页
                  </button>
                  <button
                    disabled={sessionPage === pageCount}
                    onClick={() =>
                      setSessionPages((pages) => ({
                        ...pages,
                        [selected]: sessionPage + 1,
                      }))
                    }
                  >
                    下一页
                  </button>
                </nav>
              )}
            </div>
          )}
        </section>
        <section className="terminal-panel">
          <div className="terminal-heading">
            <span>⌁ 终端</span>
            <small>Ctrl + Shift + C / V 复制粘贴 · 关闭标签保留会话</small>
            <button
              className="terminal-maximize"
              aria-pressed={terminalMaximized}
              title={terminalMaximized ? "还原终端布局" : "终端铺满窗口"}
              onClick={() => {
                setTerminalMaximized((value) => !value);
                terminals.get(active)?.term.focus();
              }}
            >
              {terminalMaximized ? "还原" : "最大化"}
            </button>
          </div>
          <div className="tabs">
            {tabs.map((t) => (
              <div
                key={t.id}
                className={"tab " + (active === t.id ? "active" : "")}
              >
                <button onClick={() => setActive(t.id)}>
                  <span
                    className={
                      "dot " + (t.closed ? "disconnected" : "connected")
                    }
                  />
                  {t.name}
                  <small>{t.serverName}</small>
                </button>
                <button
                  title="关闭标签，保留远程会话"
                  onClick={() => void run(() => closeTab(t))}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <div className="terminal-body">
            {tabs.map((t) => (
              <TerminalView key={t.id} tab={t} active={active === t.id} />
            ))}
            {!tabs.length && (
              <div className="terminal-placeholder">
                <span>›_</span>
                <h3>你的下一个任务，从这里开始</h3>
                <p>打开或新建一个会话，即可在这里操作远程终端。</p>
              </div>
            )}
          </div>
          {tabs.find((t) => t.id === active)?.closed && (
            <div className="reconnect-bar">
              连接已关闭，历史输出已保留。
              <button
                disabled={busy}
                onClick={() => {
                  const t = tabs.find((t) => t.id === active)!;
                  const s = servers.find((s) => s.id === t.serverId);
                  if (!s) {
                    setError("服务器配置已删除");
                    return;
                  }
                  if (statuses[s.id] !== "connected") {
                    setSelected(s.id);
                    startConnect(s);
                  } else
                    void run(async () => {
                      const latest = await refresh(s.id);
                      const session = latest.find((x) => x.id === t.sessionId);
                      if (!session) throw new Error("会话已不存在");
                      await attach(s, session);
                    });
                }}
              >
                {statuses[tabs.find((t) => t.id === active)!.serverId] ===
                "connected"
                  ? "重新接入（新标签）"
                  : "重新连接服务器"}
              </button>
            </div>
          )}
        </section>
        <footer>
          <span>SCREEN HARBOR</span>
          <span>
            {Object.values(statuses).filter((s) => s === "connected").length}{" "}
            台已连接 · {tabs.filter((t) => !t.closed).length} 个终端{" "}
            {busy ? " · 正在处理…" : ""}
          </span>
        </footer>
      </main>
      {editing && (
        <div className="modal-backdrop">
          <form
            className="modal"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await api.call("save", {
                  server: editing,
                  secret: secret || undefined,
                });
                setEditing(null);
                setSecret("");
                await refreshServers();
                setSelected(editing.id);
              });
            }}
          >
            <div className="modal-title">
              <h2>
                {servers.some((s) => s.id === editing.id)
                  ? "编辑服务器"
                  : "添加服务器"}
              </h2>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setEditing(null);
                  setSecret("");
                }}
              >
                ×
              </button>
            </div>
            <p>保存连接信息，随时回到你的工作现场。</p>
            <label>
              名称
              <input
                autoFocus
                required
                maxLength={80}
                value={editing.name}
                onChange={(e) =>
                  setEditing({ ...editing, name: e.target.value })
                }
                placeholder="例如：生产环境 / 开发服务器"
              />
            </label>
            <div className="form-row">
              <label>
                服务器地址
                <input
                  required
                  value={editing.host}
                  onChange={(e) =>
                    setEditing({ ...editing, host: e.target.value })
                  }
                  placeholder="192.168.1.10"
                />
              </label>
              <label className="port">
                端口
                <input
                  required
                  type="number"
                  min={1}
                  max={65535}
                  value={editing.port}
                  onChange={(e) =>
                    setEditing({ ...editing, port: Number(e.target.value) })
                  }
                />
              </label>
            </div>
            <label>
              用户名
              <input
                required
                value={editing.username}
                onChange={(e) =>
                  setEditing({ ...editing, username: e.target.value })
                }
              />
            </label>
            <label>
              认证方式
              <select
                value={editing.auth}
                onChange={(e) => {
                  setEditing({
                    ...editing,
                    auth: e.target.value as Server["auth"],
                  });
                  setSecret("");
                }}
              >
                <option value="password">密码</option>
                <option value="key">SSH 私钥</option>
              </select>
            </label>
            {editing.auth === "key" && (
              <label>
                私钥文件
                <div className="file-input">
                  <input
                    required
                    value={editing.keyPath}
                    onChange={(e) =>
                      setEditing({ ...editing, keyPath: e.target.value })
                    }
                  />
                  <button
                    type="button"
                    onClick={() =>
                      void run(async () => {
                        const p = await api.call("pickKey", {});
                        if (p) setEditing({ ...editing, keyPath: p });
                      })
                    }
                  >
                    选择
                  </button>
                </div>
              </label>
            )}
            <label>
              {editing.auth === "key" ? "私钥口令（可选）" : "密码"}
              <input
                type="password"
                autoComplete="new-password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder="留空则连接时输入或使用已保存凭据"
              />
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={editing.remember}
                onChange={(e) =>
                  setEditing({ ...editing, remember: e.target.checked })
                }
              />
              使用系统加密保存登录凭据
            </label>
            <p className="hint">
              未勾选时不会保存密码或口令。修改地址或认证配置将断开现有连接。
            </p>
            {error && <p className="form-error">{error}</p>}
            <div className="modal-actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setEditing(null);
                  setSecret("");
                }}
              >
                取消
              </button>
              <button className="primary" disabled={busy}>
                保存服务器
              </button>
            </div>
          </form>
        </div>
      )}
      {authServer && (
        <div className="modal-backdrop">
          <form
            className="modal compact"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const value = secret;
                await connect(authServer, value);
                if (authServer.remember) {
                  await api.call("save", { server: authServer, secret: value });
                  await refreshServers();
                }
              });
            }}
          >
            <h2>连接 {authServer.name}</h2>
            <p>
              {authServer.username}@{authServer.host}
            </p>
            <label>
              {authServer.auth === "key"
                ? "私钥口令（没有则留空）"
                : "SSH 密码"}
              <input
                autoFocus
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                autoComplete="off"
              />
            </label>
            {error && <p className="form-error">{error}</p>}
            <div className="modal-actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setAuthServer(null);
                  setSecret("");
                }}
              >
                取消
              </button>
              <button className="primary" disabled={busy}>
                {busy ? "连接中…" : "连接"}
              </button>
            </div>
          </form>
        </div>
      )}
      {nameDialog && (
        <div className="modal-backdrop">
          <form
            className="modal compact"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                if (nameDialog.session) {
                  await api.call("rename", {
                    serverId: nameDialog.serverId,
                    sessionId: nameDialog.session.id,
                    name: sessionName,
                  });
                  const updated = await refresh(nameDialog.serverId);
                  const renamed = updated.find(
                    (s) =>
                      s.id.split(".")[0] ===
                      nameDialog.session!.id.split(".")[0],
                  );
                  if (renamed)
                    setTabs((ts) =>
                      ts.map((t) =>
                        t.serverId === nameDialog.serverId &&
                        t.sessionId === nameDialog.session!.id
                          ? { ...t, name: renamed.name, sessionId: renamed.id }
                          : t,
                      ),
                    );
                } else {
                  const s = await api.call("create", {
                    serverId: nameDialog.serverId,
                    name: sessionName,
                  });
                  await attach(
                    servers.find((s) => s.id === nameDialog.serverId)!,
                    s,
                  );
                }
                setNameDialog(null);
              });
            }}
          >
            <h2>{nameDialog.session ? "重命名会话" : "新建会话"}</h2>
            <label>
              会话名称
              <input
                autoFocus
                required
                pattern="[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}"
                maxLength={64}
                value={sessionName}
                onChange={(e) => setSessionName(e.target.value)}
                placeholder="例如：deploy-api"
              />
            </label>
            <p className="hint">
              1–64 位字母、数字、下划线或连字符，首位为字母或数字。
            </p>
            {error && <p className="form-error">{error}</p>}
            <div className="modal-actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => setNameDialog(null)}
              >
                取消
              </button>
              <button className="primary" disabled={busy}>
                {nameDialog.session ? "保存名称" : "创建并打开"}
              </button>
            </div>
          </form>
        </div>
      )}
      {deleteId && (
        <div className="modal-backdrop">
          <div className="modal compact">
            <h2>删除服务器配置？</h2>
            <p>
              将删除本地配置和已保存凭据，并断开连接。远程 Screen 会话继续运行。
            </p>
            <div className="modal-actions">
              <button disabled={busy} onClick={() => setDeleteId("")}>
                取消
              </button>
              <button
                className="danger"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await api.call("remove", { serverId: deleteId });
                    setDeleteId("");
                    await refreshServers();
                  })
                }
              >
                删除配置
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
