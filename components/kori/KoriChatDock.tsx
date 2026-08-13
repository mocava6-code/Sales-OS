"use client";

import { useRef, useState, useTransition } from "react";
import { askKoriAction } from "@/server/actions/kori";

const STARTER_QUESTIONS = [
  "¿Cuántos clientes necesitan respuesta?",
  "¿Qué vehículo se pregunta más esta semana?",
  "Clientes con seguimiento vencido",
];

const FOLLOW_UP_QUESTIONS = ["¿Y el mes pasado?", "Muéstrame la lista completa", "¿Y los de Ranger?"];

type ChatMessage =
  | { id: number; kind: "question"; text: string }
  | { id: number; kind: "answer"; text: string }
  | { id: number; kind: "error"; text: string };

let nextMessageId = 1;

export function KoriChatDock() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isPending, startTransition] = useTransition();
  const listRef = useRef<HTMLDivElement>(null);

  function scrollToBottom() {
    requestAnimationFrame(() => listRef.current?.scrollIntoView?.({ behavior: "smooth", block: "end" }));
  }

  function ask(question: string) {
    const trimmed = question.trim();
    if (trimmed.length === 0 || isPending) return;

    setMessages((prev) => [...prev, { id: nextMessageId++, kind: "question", text: trimmed }]);
    setInputValue("");

    startTransition(async () => {
      const result = await askKoriAction({ question: trimmed });
      if (result.ok) {
        setMessages((prev) => [...prev, { id: nextMessageId++, kind: "answer", text: result.data.result.answer }]);
      } else {
        setMessages((prev) => [...prev, { id: nextMessageId++, kind: "error", text: result.error.message }]);
      }
      scrollToBottom();
    });
  }

  const suggestions = messages.length === 0 ? STARTER_QUESTIONS : FOLLOW_UP_QUESTIONS;

  return (
    <div className="sticky bottom-16 -mx-4 mt-2 border-t border-neutral-200 bg-neutral-50 px-4 pb-3 pt-2.5">
      {messages.length > 0 && (
        <div className="mb-2 max-h-64 space-y-2 overflow-y-auto">
          {messages.map((message) => (
            <div key={message.id} className={message.kind === "question" ? "flex justify-end" : "flex justify-start"}>
              <p
                className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                  message.kind === "question"
                    ? "bg-neutral-900 text-white"
                    : message.kind === "error"
                      ? "bg-red-50 text-red-700"
                      : "border border-neutral-200 bg-white text-neutral-800"
                }`}
              >
                {message.text}
              </p>
            </div>
          ))}
          {isPending && (
            <div className="flex justify-start">
              <p className="rounded-2xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-400">Kori está pensando…</p>
            </div>
          )}
          <div ref={listRef} />
        </div>
      )}

      <div className="mb-2 flex gap-1.5 overflow-x-auto pb-0.5">
        {suggestions.map((question) => (
          <button
            key={question}
            type="button"
            onClick={() => ask(question)}
            disabled={isPending}
            className="shrink-0 whitespace-nowrap rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs text-neutral-600 disabled:opacity-50"
          >
            {question}
          </button>
        ))}
      </div>

      <form
        className="flex items-center gap-2 rounded-full border border-neutral-200 bg-white py-1 pl-3.5 pr-1"
        onSubmit={(event) => {
          event.preventDefault();
          ask(inputValue);
        }}
      >
        <input
          type="text"
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
          placeholder="Pregúntale a Kori…"
          disabled={isPending}
          className="flex-1 bg-transparent text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none"
        />
        <button
          type="submit"
          disabled={isPending || inputValue.trim().length === 0}
          aria-label="Enviar pregunta"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-white disabled:bg-neutral-300"
        >
          ↑
        </button>
      </form>
    </div>
  );
}
