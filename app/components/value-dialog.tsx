'use client';

import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { toast } from 'sonner';
import { IconCopy } from '@tabler/icons-react';
import { parseDocument } from 'yaml';
import { Button } from '@egose/shadcn-theme/components/ui/button';
import { Badge } from '@egose/shadcn-theme/components/ui/badge';
import { Label } from '@egose/shadcn-theme/components/ui/label';
import { Textarea } from '@egose/shadcn-theme/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@egose/shadcn-theme/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@egose/shadcn-theme/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@egose/shadcn-theme/components/ui/select';
import { useClipboard } from '@egose/shadcn-theme/hooks/use-clipboard';
import { VALUE_CONTENT_TYPES, contentTypeLabel, detectContentType, type ValueContentType } from '@/lib/content-type';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entryKey: string;
  value: string;
  mode: 'edit' | 'view';
  onSave?: (next: string) => void;
}

type Override = ValueContentType | 'auto';

// Markdown + Prism are heavy — load only when the Preview tab first opens.
const ValuePreview = dynamic(() => import('./value-preview').then((m) => m.ValuePreview), {
  ssr: false,
  loading: () => <div className="h-[300px] animate-pulse rounded border bg-muted/40" />,
});

export function ValueDialog({ open, onOpenChange, entryKey, value, mode, onSave }: Props) {
  // Fresh state per mount — parents conditionally render the dialog only
  // while it is open, so no reset-on-open effect is needed.
  const [draft, setDraft] = useState(value);
  const [override, setOverride] = useState<Override>('auto');
  const { copy } = useClipboard();

  const detected = useMemo(() => detectContentType(entryKey, draft), [entryKey, draft]);
  const effective: ValueContentType = override === 'auto' ? detected : override;

  const jsonError = useMemo(() => {
    if (effective !== 'json') return null;
    try {
      JSON.parse(draft);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : 'Invalid JSON';
    }
  }, [effective, draft]);

  const yamlError = useMemo(() => {
    if (effective !== 'yaml') return null;
    try {
      // parseDocument collects errors instead of throwing — check explicitly.
      const doc = parseDocument(draft);
      if (doc.errors.length === 0) return null;
      return doc.errors[0].message.split('\n')[0].slice(0, 200);
    } catch (err) {
      const msg = err instanceof Error ? err.message.split('\n')[0] : 'Invalid YAML';
      return msg.slice(0, 200);
    }
  }, [effective, draft]);

  const formatError = jsonError ?? yamlError;
  const formatDisabled = draft.trim() === '' || formatError !== null;

  const stats = useMemo(() => {
    const lines = draft === '' ? 0 : draft.split('\n').length;
    const bytes = new TextEncoder().encode(draft).length;
    return { lines, bytes };
  }, [draft]);

  const close = () => onOpenChange(false);
  const save = () => {
    if (mode === 'edit' && draft !== value) onSave?.(draft);
    close();
  };

  const reformatJson = (pretty: boolean) => {
    try {
      setDraft(JSON.stringify(JSON.parse(draft), null, pretty ? 2 : 0));
    } catch {
      toast.error('Cannot format: value is not valid JSON');
    }
  };

  // Document round-trip (not parse+stringify) so comments survive formatting.
  const formatYaml = () => {
    try {
      const doc = parseDocument(draft);
      if (doc.errors.length > 0) {
        toast.error('Cannot format: value is not valid YAML');
        return;
      }
      setDraft(doc.toString());
    } catch {
      toast.error('Cannot format: value is not valid YAML');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{entryKey || '(unnamed key)'}</span>
            <Badge variant="secondary" size="sm">
              {contentTypeLabel(effective)}
              {override === 'auto' ? ' (auto)' : ''}
            </Badge>
          </DialogTitle>
          <DialogDescription>
            {mode === 'edit' ? 'Edit the value below. Newlines are preserved.' : 'Full value with newlines preserved.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor="value-content-type" className="text-xs text-muted-foreground">
            Content type
          </Label>
          <Select value={override} onValueChange={(v) => setOverride(v as Override)}>
            <SelectTrigger id="value-content-type" className="w-[180px]">
              <SelectValue placeholder="Auto-detect" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto-detect</SelectItem>
              {VALUE_CONTENT_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {effective === 'json' && (
            <>
              <Button
                type="button"
                variant="secondary"
                appearance="outline"
                size="sm"
                disabled={formatDisabled}
                onClick={() => reformatJson(true)}
              >
                Prettify
              </Button>
              <Button
                type="button"
                variant="secondary"
                appearance="outline"
                size="sm"
                disabled={formatDisabled}
                onClick={() => reformatJson(false)}
              >
                Minify
              </Button>
            </>
          )}
          {effective === 'yaml' && (
            <Button
              type="button"
              variant="secondary"
              appearance="outline"
              size="sm"
              disabled={formatDisabled}
              onClick={formatYaml}
            >
              Format
            </Button>
          )}
          <div className="flex-1" />
          <Button
            type="button"
            variant="secondary"
            appearance="ghost"
            size="sm"
            onClick={() => copy(mode === 'edit' ? draft : value)}
            aria-label="Copy value"
          >
            <IconCopy size={14} /> Copy
          </Button>
        </div>

        <Tabs defaultValue="raw">
          <TabsList>
            <TabsTrigger value="raw">Raw</TabsTrigger>
            <TabsTrigger value="preview">Preview</TabsTrigger>
          </TabsList>
          <TabsContent value="raw" className="flex flex-col gap-2">
            <Textarea
              aria-label="Secret value"
              value={draft}
              onChange={(ev) => setDraft(ev.target.value)}
              readOnly={mode === 'view'}
              rows={14}
              className="font-mono text-xs"
              placeholder={mode === 'edit' ? 'Value (multiline supported)' : undefined}
              spellCheck={false}
            />
            {formatError && <p className="text-xs text-destructive">{formatError}</p>}
          </TabsContent>
          <TabsContent value="preview">
            <ValuePreview value={draft} contentType={effective} />
          </TabsContent>
        </Tabs>

        <p className="text-xs text-muted-foreground">
          {stats.lines} line{stats.lines === 1 ? '' : 's'} · {(stats.bytes / 1024).toFixed(1)} KiB
        </p>

        <DialogFooter>
          {mode === 'edit' ? (
            <>
              <Button type="button" variant="secondary" appearance="outline" onClick={close}>
                Cancel
              </Button>
              <Button type="button" variant="primary" onClick={save}>
                Save
              </Button>
            </>
          ) : (
            <Button type="button" variant="secondary" appearance="outline" onClick={close}>
              Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
