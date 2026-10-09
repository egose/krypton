'use client';

import { useState } from 'react';
import { IconCopy, IconEye, IconEyeOff } from '@tabler/icons-react';
import { Button } from '@egose/shadcn-theme/components/ui/button';
import { useClipboard } from '@egose/shadcn-theme/hooks/use-clipboard';

/** Values are masked by default — mirroring kubectl's redaction behavior. */
export function RevealValue({ value }: { value: string }) {
  const [revealed, setRevealed] = useState(false);
  const { copy } = useClipboard();

  return (
    <div className="flex items-center gap-1.5">
      <code className="max-w-[420px] flex-1 truncate rounded bg-muted px-2 py-1 font-mono text-xs">
        {revealed ? value || <span className="opacity-50">(empty)</span> : '••••••••••••'}
      </code>
      <Button
        variant="secondary"
        appearance="ghost"
        size="icon-xs"
        onClick={() => setRevealed((v) => !v)}
        aria-label={revealed ? 'Hide value' : 'Reveal value'}
      >
        {revealed ? <IconEyeOff size={14} /> : <IconEye size={14} />}
      </Button>
      <Button variant="secondary" appearance="ghost" size="icon-xs" onClick={() => copy(value)} aria-label="Copy value">
        <IconCopy size={14} />
      </Button>
    </div>
  );
}
