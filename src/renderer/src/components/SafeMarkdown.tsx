import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import type { AnchorHTMLAttributes, ReactNode } from "react";

const ALLOWED_EXTERNAL_PROTOCOLS = new Set(["http:", "https:"]);

function safeExternalUrl(href: string | undefined): string | null {
  if (!href) return null;
  try {
    const url = new URL(href);
    return ALLOWED_EXTERNAL_PROTOCOLS.has(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function SafeMarkdownLink({
  href,
  children,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { children?: ReactNode }) {
  const externalUrl = safeExternalUrl(href);
  if (!externalUrl) {
    return <span>{children}</span>;
  }

  return (
    <a
      {...props}
      href={externalUrl}
      rel="noreferrer"
      onClick={(e) => {
        e.preventDefault();
        void window.api.shell.openExternal(externalUrl);
      }}
    >
      {children}
    </a>
  );
}

export function SafeMarkdown({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <ReactMarkdown
        skipHtml
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{ a: SafeMarkdownLink }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
