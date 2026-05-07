import { useState } from "react";
import { ClipboardIcon, CheckIcon } from "@heroicons/react/20/solid";

interface Props {
  value: string;
  /** Hide until the parent's `group` is hovered. Defaults to true. */
  hoverReveal?: boolean;
  className?: string;
  title?: string;
}

export function CopyButton({
  value,
  hoverReveal = true,
  className = "",
  title = "Copy",
}: Props) {
  const [copied, setCopied] = useState(false);
  const reveal = hoverReveal
    ? "opacity-0 group-hover:opacity-100"
    : "opacity-100";
  return (
    <button
      className={`shrink-0 w-5 h-5 flex items-center justify-center bg-transparent border-none text-fg-muted cursor-pointer hover:text-fg transition-opacity ${reveal} ${className}`}
      onClick={async (e) => {
        e.stopPropagation();
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      title={copied ? "Copied!" : title}
    >
      {copied ? (
        <CheckIcon className="w-3.5 h-3.5 text-green" />
      ) : (
        <ClipboardIcon className="w-3.5 h-3.5" />
      )}
    </button>
  );
}
