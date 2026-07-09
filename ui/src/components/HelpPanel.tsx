// ui/src/components/HelpPanel.tsx
//
// Generic, data-driven in-app help. A HelpPanel renders any HelpCard from the
// registry (ui/src/help/) as a wide bilingual (EN/FR) Modal with copy-able
// commands, code snippets, callouts and doc links. Content lives as DATA in
// ui/src/help/cards/*, so adding help for a new feature is just authoring a card
// — this component never changes.
//
// No i18n library: each card carries parallel { en, fr } bodies and a small
// `lang` toggle picks the active one (defaults to EN).

import { useState, type ReactNode } from "react";
import { Modal } from "./Modal";
import { ActionButton } from "./ActionButton";
import { IconCopy, IconCheck, IconExternal } from "./icons";
import { toast } from "../lib/toast";
import { getHelpCard } from "../help/registry";
import type { HelpBlock, HelpBody, Lang } from "../help/types";

interface HelpPanelProps {
  /** Registry key of the card to show (e.g. "workloads", "swarm"). */
  topic: string;
  open: boolean;
  onClose: () => void;
}

const COPY_LABEL: Record<Lang, string> = {
  en: "Copied to clipboard",
  fr: "Copié dans le presse-papiers",
};

/* ------------------------------------------------------------------ */
/* Inline markup: **bold** and `code` inside a plain string.           */
/* ------------------------------------------------------------------ */

function renderInline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter((p) => p !== "");
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={i}>{part.slice(1, -1)}</code>;
    }
    return <span key={i}>{part}</span>;
  });
}

/* ------------------------------------------------------------------ */
/* Copy-able shell command                                             */
/* ------------------------------------------------------------------ */

function CommandBlock({ command, copyLabel }: { command: string; copyLabel: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      toast.success(copyLabel);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error(copyLabel, command);
    }
  };
  return (
    <div className="help-cmd">
      <code className="help-cmd-text">{command}</code>
      <button
        type="button"
        className="btn btn-ghost btn-sm btn-icon help-cmd-copy"
        onClick={copy}
        aria-label={copyLabel}
        title={copyLabel}
      >
        {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Block dispatcher                                                    */
/* ------------------------------------------------------------------ */

function Block({ block, copyLabel }: { block: HelpBlock; copyLabel: string }) {
  switch (block.kind) {
    case "p":
      return <p className="help-p">{renderInline(block.text)}</p>;
    case "note":
      return <p className="help-p help-note">{renderInline(block.text)}</p>;
    case "list":
      return (
        <ul className="help-ul">
          {block.items.map((it, i) => (
            <li key={i}>{renderInline(it)}</li>
          ))}
        </ul>
      );
    case "cmd":
      return <CommandBlock command={block.command} copyLabel={copyLabel} />;
    case "code":
      return (
        <pre className="help-code">
          <code>{block.code}</code>
        </pre>
      );
    case "callout":
      return (
        <div className={`help-callout help-callout--${block.tone}`}>{renderInline(block.text)}</div>
      );
    case "doc":
      return (
        <a className="help-doclink" href={block.href} target="_blank" rel="noopener noreferrer">
          {block.label}
          <IconExternal size={13} />
        </a>
      );
    default:
      return null;
  }
}

function Body({ body, copyLabel }: { body: HelpBody; copyLabel: string }) {
  return (
    <>
      {body.summary ? <p className="help-summary">{renderInline(body.summary)}</p> : null}
      {body.sections.map((section, si) => (
        <section className="help-section" key={si}>
          <h3 className="help-section-title">{section.title}</h3>
          {section.blocks.map((b, bi) => (
            <Block key={bi} block={b} copyLabel={copyLabel} />
          ))}
        </section>
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Panel                                                               */
/* ------------------------------------------------------------------ */

export function HelpPanel({ topic, open, onClose }: HelpPanelProps) {
  const [lang, setLang] = useState<Lang>("en");
  const card = getHelpCard(topic);

  // Unknown topic → render nothing rather than crash. A unit test guards the
  // registry so this only ever bites during authoring.
  if (!card) return null;

  const body = card[lang];

  return (
    <Modal
      open={open}
      wide
      onClose={onClose}
      title={
        <div className="help-head">
          <span>{card.title[lang]}</span>
          <div className="help-lang" role="group" aria-label="Language">
            <button
              type="button"
              className={`help-lang-btn${lang === "en" ? " active" : ""}`}
              aria-pressed={lang === "en"}
              onClick={() => setLang("en")}
            >
              EN
            </button>
            <button
              type="button"
              className={`help-lang-btn${lang === "fr" ? " active" : ""}`}
              aria-pressed={lang === "fr"}
              onClick={() => setLang("fr")}
            >
              FR
            </button>
          </div>
        </div>
      }
      footer={
        <ActionButton variant="primary" onClick={onClose}>
          {lang === "fr" ? "Fermer" : "Close"}
        </ActionButton>
      }
    >
      <div className="help-body">
        <Body body={body} copyLabel={COPY_LABEL[lang]} />
      </div>
    </Modal>
  );
}
