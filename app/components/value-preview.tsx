'use client';

import type { AnchorHTMLAttributes } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Highlight, themes } from 'prism-react-renderer';
import { useTheme } from 'next-themes';
import type { ValueContentType } from '@/lib/content-type';

// Lazily loaded by value-dialog (Markdown + Prism stay out of the page bundle).

const PRISM_LANGUAGE: Record<ValueContentType, string> = {
  json: 'json',
  yaml: 'yaml',
  markdown: 'markdown',
  pem: 'text',
  xml: 'markup',
  text: 'text',
};

interface Props {
  value: string;
  contentType: ValueContentType;
}

export function ValuePreview({ value, contentType }: Props) {
  const { resolvedTheme } = useTheme();

  if (value === '') return <p className="text-xs text-muted-foreground">(empty)</p>;

  // No rehype-raw: raw HTML in values renders as inert text, never as DOM —
  // secret values must not become an XSS vector. Links open in a new tab.
  if (contentType === 'markdown') {
    return (
      <div
        data-testid="value-preview"
        className="max-h-[380px] overflow-auto rounded border bg-muted/30 p-4 text-sm [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:pl-2 [&_blockquote]:opacity-80 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-xs [&_h1]:mb-2 [&_h1]:text-xl [&_h1]:font-bold [&_h2]:mb-1 [&_h2]:mt-3 [&_h2]:text-lg [&_h2]:font-bold [&_h3]:text-base [&_h3]:font-semibold [&_hr]:my-3 [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_pre]:overflow-auto [&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-2 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_table]:my-2 [&_table]:border-collapse [&_table]:text-xs [&_td]:border [&_td]:px-2 [&_th]:border [&_th]:px-2"
      >
        <Markdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => (
              <a {...props} target="_blank" rel="noopener noreferrer" />
            ),
          }}
        >
          {value}
        </Markdown>
      </div>
    );
  }

  const theme = resolvedTheme === 'light' ? themes.vsLight : themes.vsDark;
  return (
    <Highlight theme={theme} language={PRISM_LANGUAGE[contentType]} code={value}>
      {({ className, style, tokens, getLineProps, getTokenProps }) => (
        <pre
          data-testid="value-preview"
          className={`${className} max-h-[380px] overflow-auto rounded border p-3 font-mono text-xs`}
          style={style}
        >
          {tokens.map((line, i) => (
            <div key={i} {...getLineProps({ line })}>
              {line.map((token, key) => (
                <span key={key} {...getTokenProps({ token })} />
              ))}
            </div>
          ))}
        </pre>
      )}
    </Highlight>
  );
}
