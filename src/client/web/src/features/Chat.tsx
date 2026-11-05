/**
 * AI 悬浮窗：前端工具循环的 UI（DESIGN.md §3.4）。
 *
 * - 流式输出 + 工具卡片（读/写标签）；write-gate 确认条（会话级授权，仅存当前对话内存）；
 * - 会话历史经 ai/sessionStore 落 IndexedDB，刷新可恢复；服务端零留存、无会话 API；
 * - 无网/无 token 时给出提示（离线时本地工具照常，仅 LLM 回复需要网络）；
 * - 写工具执行后刷新文件树（AI 直接改了本地文件）。
 *
 * 注：DESIGN §7 选型 assistant-ui LocalRuntime——其 v0.15 运行时 API 面较大，
 * 当前用自研轻量循环（ai/agent.ts，事件形态与 ChatModelAdapter 同构），
 * 后续换入只改本文件的消费端，agent/tools/sessionStore/transport 全部复用。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { runAgentTurn, type GateRequest } from "../ai/agent";
import { createTransport, type ChatMessage, type LlmTransport } from "../ai/llmTransport";
import { sessionStore } from "../ai/sessionStore";
import { writeToolNames } from "../ai/tools";
import { OfflineError, AuthExpiredError } from "../lib/errors";
import { useAuthStore } from "../state/auth";
import { useNotesStore } from "../state/notes";

const CONVERSATION_ID = "main";

type UiMsg =
  | { key: number; role: "user"; text: string }
  | { key: number; role: "assistant"; text: string }
  | { key: number; role: "tool"; name: string; args: string; result: string; ok: boolean };

/** 会话消息 → 展示项（重建工具卡片与流式文本） */
function fromMessages(msgs: ChatMessage[]): { ui: UiMsg[]; history: ChatMessage[] } {
  const ui: UiMsg[] = [];
  let key = 0;
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if (m.role === "system") continue;
    if (m.role === "user") {
      if (m.content) ui.push({ key: key++, role: "user", text: m.content });
    } else if (m.role === "assistant" && m.tool_calls) {
      for (const tc of m.tool_calls) {
        const result = msgs.slice(i + 1).find((x) => x.role === "tool" && x.tool_call_id === tc.id);
        const content = result?.content ?? "…";
        ui.push({
          key: key++,
          role: "tool",
          name: tc.function.name,
          args: tc.function.arguments,
          result: content,
          ok: !content.includes('"error"'),
        });
      }
    } else if (m.role === "assistant" && m.content) {
      ui.push({ key: key++, role: "assistant", text: m.content });
    }
  }
  return { ui, history: msgs.filter((m) => m.role !== "system") };
}

export function Chat({ onClose }: { onClose?: () => void }) {
  const [msgs, setMsgs] = useState<UiMsg[]>([]);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gate, setGate] = useState<{ name: string; desc: string } | null>(null);
  const [authorized, setAuthorized] = useState(false);

  const historyRef = useRef<ChatMessage[]>([]);
  const keysRef = useRef(0);
  const nid = () => ++keysRef.current;
  const authorizedRef = useRef(false);
  const gateResolveRef = useRef<((ok: boolean) => void) | null>(null);
  const transportRef = useRef<LlmTransport | null>(null);
  transportRef.current ??= createTransport();
  const bodyRef = useRef<HTMLDivElement | null>(null);

  const hasToken = useAuthStore((s) => s.hasToken);

  // 恢复上次会话（仅本机 IndexedDB）
  useEffect(() => {
    void sessionStore.load(CONVERSATION_ID).then((rec) => {
      if (rec?.messages.length) {
        const { ui, history } = fromMessages(rec.messages);
        setMsgs(ui);
        historyRef.current = history;
      }
    });
  }, []);

  // 新消息滚到底
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [msgs, gate]);

  // write-gate：写工具执行前征求确认（会话级授权只存本对话内存，不持久化）
  const onGate = useCallback((req: GateRequest): Promise<boolean> => {
    if (authorizedRef.current) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      gateResolveRef.current = resolve;
      setGate({
        name: req.name,
        desc: `${req.name}(${JSON.stringify(req.args).slice(0, 80)})`,
      });
    });
  }, []);

  const answerGate = (ok: boolean) => {
    gateResolveRef.current?.(ok);
    gateResolveRef.current = null;
    setGate(null);
  };

  const send = async () => {
    const text = input.trim();
    if (!text || running) return;
    const storage = useNotesStore.getState().storage;
    if (!storage) return;

    setInput("");
    setRunning(true);
    setError(null);
    const userKey = nid();
    setMsgs((m) => [...m, { key: userKey, role: "user", text }]);

    let assistantKey: number | null = null;
    let toolKey: number | null = null;
    let anyWrite = false;
    let wroteCurrent = false;
    const currentPath = useNotesStore.getState().currentPath;

    try {
      let final: ChatMessage[] | null = null;
      const events = runAgentTurn(
        { transport: transportRef.current!, storage, conversationId: CONVERSATION_ID, onGate },
        historyRef.current,
        text,
      );
      for await (const ev of events) {
        switch (ev.type) {
          case "text": {
            if (assistantKey === null) {
              assistantKey = nid();
              const k = assistantKey;
              setMsgs((m) => [...m, { key: k, role: "assistant", text: ev.text }]);
            } else {
              const k = assistantKey;
              setMsgs((m) =>
                m.map((x) => (x.key === k && x.role === "assistant" ? { ...x, text: x.text + ev.text } : x)),
              );
            }
            break;
          }
          case "tool_start": {
            if (writeToolNames.has(ev.name)) {
              anyWrite = true;
              const p = (ev.args as { path?: string }).path;
              if (p && p === currentPath) wroteCurrent = true;
            }
            toolKey = nid();
            const k = toolKey;
            setMsgs((m) => [
              ...m,
              { key: k, role: "tool", name: ev.name, args: JSON.stringify(ev.args), result: "…", ok: true },
            ]);
            break;
          }
          case "tool_end": {
            const k = toolKey;
            if (k !== null) {
              const result = typeof ev.result === "string" ? ev.result : JSON.stringify(ev.result);
              setMsgs((m) => m.map((x) => (x.key === k ? { ...x, result, ok: ev.ok } : x)));
            }
            break;
          }
          case "error":
            setError(ev.error);
            break;
          case "done":
            final = ev.messages;
            break;
        }
      }
      if (final) {
        historyRef.current = final.filter((m) => m.role !== "system");
        await sessionStore.save({
          conversationId: CONVERSATION_ID,
          messages: final,
          updatedAt: Date.now(),
        });
      }
      // AI 直接改了本地文件：刷新树；若动了当前打开的文件则重载内容
      if (anyWrite) {
        const notes = useNotesStore.getState();
        await notes.refresh();
        if (wroteCurrent && notes.currentPath) await notes.open(notes.currentPath);
      }
    } catch (e) {
      if (e instanceof OfflineError) setError("离线——AI 回复需要网络，本地工具与笔记不受影响");
      else if (e instanceof AuthExpiredError) setError("需要登录才能使用 AI（本地功能照常）");
      else setError(String((e as Error)?.message ?? e));
    } finally {
      setRunning(false);
    }
  };

  const resetConversation = () => {
    if (running) return;
    setMsgs([]);
    historyRef.current = [];
    setError(null);
    authorizedRef.current = false;
    setAuthorized(false);
    void sessionStore.clear(CONVERSATION_ID);
  };

  const toggleAuthorize = (on: boolean) => {
    authorizedRef.current = on;
    setAuthorized(on);
  };

  return (
    <>
      <div className="ai-head">
        ✦ AI 助手
        <span className={`badge${authorized ? "" : " off"}`}>
          {authorized ? "会话已授权写入" : "写入需确认"}
        </span>
        <button className="x" title="新对话" onClick={resetConversation} style={{ marginLeft: 12 }}>
          ⟲
        </button>
        <button className="x" onClick={onClose} title="关闭">
          ×
        </button>
      </div>

      <div className="ai-body" ref={bodyRef}>
        {msgs.length === 0 && (
          <div className="msg-sys">
            {hasToken
              ? "问我任何事——工具直接读写本地笔记（离线可用）"
              : "未登录：AI 回复需登录（口令永不上传），本地功能照常"}
            <br />
            例如：「列出所有笔记」「把部署相关的整理到 projects/」
          </div>
        )}
        {msgs.map((m) =>
          m.role === "user" ? (
            <div key={m.key} className="msg-user">
              {m.text}
            </div>
          ) : m.role === "assistant" ? (
            <div key={m.key} className="msg-ai">
              {m.text}
            </div>
          ) : (
            <div key={m.key} className="tool-card">
              <span className={`tag${writeToolNames.has(m.name) ? "" : " read"}`}>
                {writeToolNames.has(m.name) ? "写" : "读"}
              </span>
              {m.name}({m.args}) → {m.ok ? "" : "✗ "}
              {m.result}
            </div>
          ),
        )}
        {running && <div className="msg-sys">思考中…</div>}
        {error && <div className="msg-sys" style={{ color: "var(--danger)" }}>⚠ {error}</div>}
      </div>

      {gate && (
        <div className="gate-bar">
          <span className="desc">授权写入？{gate.desc}</span>
          <button className="nb-btn" onClick={() => answerGate(true)}>
            允许
          </button>
          <button className="nb-btn danger" onClick={() => answerGate(false)}>
            拒绝
          </button>
        </div>
      )}

      <div className="ai-input">
        <textarea
          placeholder="让 AI 帮你管理笔记…（Enter 发送）"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button disabled={running || !input.trim()} onClick={() => void send()}>
          发送
        </button>
      </div>
      <div className="gate-bar" style={{ borderTop: "none", background: "var(--card)" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={authorized}
            onChange={(e) => toggleAuthorize(e.target.checked)}
          />
          本对话免确认写入（仅当前会话内存，不持久化）
        </label>
      </div>
    </>
  );
}
