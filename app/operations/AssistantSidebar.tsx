"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { Bot, LoaderCircle, Send, X } from "lucide-react";
import type { AssistantResponse } from "@/src/lib/operational-types";
import type { Role } from "@/src/lib/types";
import styles from "./AssistantSidebar.module.css";

export type InsightsAssistantRequest = { id: string; from: string; to: string };

type ConversationMessage = {
  id: string;
  question: string;
  role: Role;
  answer?: AssistantResponse;
  error?: string;
};

type AssistantSidebarProps = {
  open: boolean;
  role: Role;
  insightRequest: InsightsAssistantRequest | null;
  onClose: () => void;
};

function computedTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("en-MY", { dateStyle: "medium", timeStyle: "short" });
}

export default function AssistantSidebar({
  open,
  role,
  insightRequest,
  onClose,
}: AssistantSidebarProps) {
  const titleId = useId();
  const inputId = useId();
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const handledInsightRequest = useRef<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messageEndRef = useRef<HTMLDivElement>(null);

  const ask = useCallback(async (
    prompt: string,
    context?: { from: string; to: string; mode: "insights" },
  ) => {
    const trimmed = prompt.trim();
    if (!trimmed || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const id = crypto.randomUUID();
    setMessages((current) => [...current, { id, question: trimmed, role }]);

    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ question: trimmed, ...context }),
      });
      const result = await response.json().catch(() => ({})) as AssistantResponse & { error?: string };
      if (!response.ok) {
        throw new Error(result.error || `The assistant request failed (${response.status}).`);
      }
      setMessages((current) => current.map((message) =>
        message.id === id ? { ...message, answer: result } : message,
      ));
    } catch (error) {
      const message = error instanceof Error ? error.message : "The assistant request failed.";
      setMessages((current) => current.map((item) =>
        item.id === id ? { ...item, error: message } : item,
      ));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [role]);

  useEffect(() => {
    if (!insightRequest || handledInsightRequest.current === insightRequest.id) return;
    handledInsightRequest.current = insightRequest.id;
    void ask("Explain the recorded sales and waste insights", {
      from: insightRequest.from,
      to: insightRequest.to,
      mode: "insights",
    });
  }, [ask, insightRequest]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages, busy]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || busyRef.current) return;
    setQuestion("");
    void ask(trimmed);
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  return (
    <aside
      className={`${styles.drawer} ${open ? styles.open : ""}`}
      id="freshflow-assistant-sidebar"
      aria-labelledby={titleId}
      aria-hidden={!open}
      inert={!open}
      role="complementary"
    >
      <header className={styles.header}>
        <div className={styles.heading}>
          <div className={styles.icon}><Bot size={18} aria-hidden="true" /></div>
          <div>
            <h2 id={titleId}>FreshFlow assistant</h2>
            <p>Read-only answers from recorded data</p>
          </div>
        </div>
        <button className={styles.close} type="button" onClick={onClose} aria-label="Close AI assistant">
          <X size={18} aria-hidden="true" />
        </button>
      </header>

      <div className={styles.profileNotice}>
        <span>{role === "owner" ? "Owner" : "Staff"} testing profile</span>
        <span className={styles.readOnly}>Read only</span>
      </div>

      <div className={styles.conversation} role="log" aria-live="polite" aria-relevant="additions text">
        {messages.length === 0 && (
          <div className={styles.empty}>
            <span className={styles.emptyIcon}><Bot size={21} aria-hidden="true" /></span>
            <h3>What would you like to know?</h3>
            <p>Ask about recorded stock, expiry, tasks, decisions or insights. Answers are read-only and include available evidence and limitations.</p>
          </div>
        )}
        {messages.map((message) => (
          <article className={styles.turn} key={message.id}>
            <div className={styles.userMessage}>
              <span className={styles.messageMeta}>You · {message.role === "owner" ? "Owner profile" : "Staff profile"}</span>
              <p>{message.question}</p>
            </div>
            {message.error && <p className={styles.error} role="alert">{message.error}</p>}
            {message.answer && (
              <div className={styles.answer}>
                <div className={styles.answerMeta}>
                  <span><Bot size={14} aria-hidden="true" /> FreshFlow</span>
                  <time dateTime={message.answer.computedAt}>{computedTime(message.answer.computedAt)}</time>
                </div>
                <p className={styles.answerText}>{message.answer.answer}</p>
                {message.answer.evidence.length > 0 ? (
                  <details className={styles.evidence}>
                    <summary>Supporting records ({message.answer.evidence.length})</summary>
                    <div className={styles.evidenceList}>
                      {message.answer.evidence.map((record) => (
                        <section className={styles.evidenceRecord} key={record.id}>
                          <div className={styles.evidenceHeading}>
                            <strong>{record.label}</strong>
                            <span>{record.kind}</span>
                          </div>
                          <ul>
                            {Object.entries(record.facts).map(([key, value]) => (
                              <li key={key}><strong>{key}:</strong> {typeof value === "string" ? value : JSON.stringify(value)}</li>
                            ))}
                          </ul>
                        </section>
                      ))}
                    </div>
                  </details>
                ) : (
                  <p className={styles.evidenceNote}>No supporting records were returned.</p>
                )}
                {message.answer.limitations.length > 0 && (
                  <details className={styles.evidence}>
                    <summary>Limitations ({message.answer.limitations.length})</summary>
                    <ul className={styles.limitations}>
                      {message.answer.limitations.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}
                    </ul>
                  </details>
                )}
              </div>
            )}
          </article>
        ))}
        {busy && (
          <div className={styles.pending} role="status" aria-live="polite">
            <LoaderCircle size={15} className={styles.spinner} aria-hidden="true" />
            Checking recorded information…
          </div>
        )}
        <div ref={messageEndRef} />
      </div>

      <form className={styles.composer} onSubmit={submit}>
        <label className={styles.srOnly} htmlFor={inputId}>Ask FreshFlow a question</label>
        <textarea
          ref={inputRef}
          id={inputId}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={handleInputKeyDown}
          placeholder="Ask about recorded operations…"
          rows={2}
          maxLength={2000}
        />
        <div className={styles.composerFooter}>
          <span>Enter a question · Ctrl/⌘ + Enter to send</span>
          <button type="submit" disabled={busy || !question.trim()} aria-label="Send question">
            <Send size={15} aria-hidden="true" />
            <span>Send</span>
          </button>
        </div>
      </form>
    </aside>
  );
}
