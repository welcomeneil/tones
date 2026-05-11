"use client";

import { useId, useState } from "react";

type Props = {
  question: string;
  answer: string;
};

export function FaqItem({ question, answer }: Props) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="faq-trigger group flex w-full items-baseline justify-between gap-6 py-6 text-left"
      >
        <span className="font-serif text-xl text-[var(--foreground)] group-hover:text-[var(--accent)]">
          {question}
        </span>
        <span
          aria-hidden="true"
          className="faq-caret font-mono text-base leading-none text-[var(--muted)] group-hover:text-[var(--foreground)]"
        >
          +
        </span>
      </button>
      <div
        id={panelId}
        className="faq-panel"
        data-open={open}
        role="region"
        aria-hidden={!open}
      >
        <div className="faq-panel-inner">
          <p className="max-w-2xl pb-6 text-base leading-relaxed text-[var(--muted)]">
            {answer}
          </p>
        </div>
      </div>
    </div>
  );
}
