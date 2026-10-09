'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { IconEye, IconEyeOff, IconPlus, IconTrash } from '@tabler/icons-react';
import { Button } from '@egose/shadcn-theme/components/ui/button';
import { Input } from '@egose/shadcn-theme/components/ui/input';
import { Label } from '@egose/shadcn-theme/components/ui/label';
import { Textarea } from '@egose/shadcn-theme/components/ui/textarea';
import { Alert } from '@egose/shadcn-theme/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@egose/shadcn-theme/components/ui/card';
import { api, ApiError } from '@/lib/api-client';
import type { SecretDetail } from '@/lib/secrets';

const formSchema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .max(253)
    .regex(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/, 'Must be a DNS subdomain name'),
  type: z.string().min(1).max(64),
  description: z.string().max(1024),
  allowedGroups: z.string(),
  allowedUsers: z.string(),
});

type FormValues = z.infer<typeof formSchema>;

interface Entry {
  id: number;
  key: string;
  value: string;
  revealed: boolean;
}

let nextId = 1;
const toEntries = (data: Record<string, string>): Entry[] =>
  Object.entries(data).map(([key, value]) => ({ id: nextId++, key, value, revealed: false }));

function parseCsv(s: string): string[] {
  return s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

interface Props {
  mode: 'create' | 'edit';
  namespace: string;
  initial?: SecretDetail;
}

export function SecretForm({ mode, namespace, initial }: Props) {
  const router = useRouter();
  const [entries, setEntries] = useState<Entry[]>(() =>
    initial ? toEntries(initial.data) : [{ id: nextId++, key: '', value: '', revealed: false }],
  );
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: initial?.name ?? '',
      type: initial?.type ?? 'Opaque',
      description: initial?.description ?? '',
      allowedGroups: (initial?.allowedGroups ?? []).join(', '),
      allowedUsers: (initial?.allowedUsers ?? []).join(', '),
    },
  });

  const payloadBytes = useMemo(() => {
    let size = 0;
    for (const e of entries) {
      size += new TextEncoder().encode(e.key).length + new TextEncoder().encode(e.value).length;
    }
    return Math.ceil(size * 1.4);
  }, [entries]);
  const overLimit = payloadBytes > 1024 * 1024;

  const setEntry = (id: number, patch: Partial<Entry>) =>
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  const removeEntry = (id: number) => setEntries((prev) => prev.filter((e) => e.id !== id));
  const addEntry = () => setEntries((prev) => [...prev, { id: nextId++, key: '', value: '', revealed: false }]);

  const onSubmit = async (values: FormValues) => {
    const data: Record<string, string> = {};
    for (const e of entries) {
      const k = e.key.trim();
      if (!k) continue;
      if (k in data) {
        toast.error(`Duplicate key "${k}"`);
        return;
      }
      data[k] = e.value;
    }
    if (overLimit) {
      toast.error('Payload exceeds the Kubernetes 1MiB secret limit');
      return;
    }
    setSaving(true);
    setConflict(false);
    try {
      if (mode === 'create') {
        await api.createSecret(namespace, {
          name: values.name.trim(),
          type: values.type || 'Opaque',
          data,
          description: values.description,
          allowedGroups: parseCsv(values.allowedGroups),
          allowedUsers: parseCsv(values.allowedUsers),
        });
        toast.success(`Secret "${values.name}" created`);
        router.push(`/secrets/${namespace}/${values.name.trim()}`);
      } else {
        if (!initial) return;
        await api.updateSecret(namespace, initial.name, {
          data,
          description: values.description,
          allowedGroups: parseCsv(values.allowedGroups),
          allowedUsers: parseCsv(values.allowedUsers),
          resourceVersion: initial.resourceVersion,
        });
        toast.success(`Secret "${initial.name}" updated — snapshot v${initial.version || 1} kept for rollback`);
        router.push(`/secrets/${namespace}/${initial.name}`);
        router.refresh();
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setConflict(true);
        toast.error(mode === 'create' ? 'A secret with this name already exists' : 'Write conflict — reload and retry');
      } else {
        toast.error(err instanceof Error ? err.message : 'Save failed');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
      {conflict && mode === 'edit' && (
        <Alert variant="warning">
          <div>
            This secret changed since you loaded it (resourceVersion mismatch).{' '}
            <button type="button" className="font-medium underline" onClick={() => router.refresh()}>
              Reload latest
            </button>{' '}
            and re-apply your changes.
          </div>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{mode === 'create' ? 'New secret' : `Edit ${initial?.name}`}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                {...form.register('name')}
                disabled={mode === 'edit'}
                placeholder="database-credentials"
              />
              {form.formState.errors.name && (
                <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="type">Type</Label>
              <Input id="type" {...form.register('type')} placeholder="Opaque" />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="description">Description</Label>
            <Input id="description" {...form.register('description')} placeholder="What is this used for?" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="allowedGroups">Allowed SSO groups (comma-separated)</Label>
              <Input id="allowedGroups" {...form.register('allowedGroups')} placeholder="dev-team, database-admins" />
              <p className="text-xs text-muted-foreground">
                Stored as annotation <code>krypton.io/allowed-groups</code>. Empty = namespace default.
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="allowedUsers">Allowed users (comma-separated emails)</Label>
              <Input id="allowedUsers" {...form.register('allowedUsers')} placeholder="alice@company.com" />
              <p className="text-xs text-muted-foreground">
                Stored as annotation <code>krypton.io/allowed-users</code>.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Key–value data</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {entries.map((e) => (
            <div key={e.id} className="flex items-center gap-2">
              <Input
                placeholder="KEY"
                value={e.key}
                onChange={(ev) => setEntry(e.id, { key: ev.target.value })}
                className="w-48 font-mono"
              />
              <div className="relative flex-1">
                <Input
                  type={e.revealed ? 'text' : 'password'}
                  placeholder="value"
                  value={e.value}
                  onChange={(ev) => setEntry(e.id, { value: ev.target.value })}
                  className="pr-9 font-mono"
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setEntry(e.id, { revealed: !e.revealed })}
                  aria-label={e.revealed ? 'Hide' : 'Show'}
                >
                  {e.revealed ? <IconEyeOff size={15} /> : <IconEye size={15} />}
                </button>
              </div>
              <Button
                type="button"
                variant="danger"
                appearance="ghost"
                size="icon-sm"
                onClick={() => removeEntry(e.id)}
                aria-label="Remove entry"
              >
                <IconTrash size={15} />
              </Button>
            </div>
          ))}
          <div>
            <Button type="button" variant="secondary" appearance="outline" size="sm" onClick={addEntry}>
              <IconPlus size={15} /> Add entry
            </Button>
          </div>
          <p className={`text-xs ${overLimit ? 'font-medium text-destructive' : 'text-muted-foreground'}`}>
            Estimated payload ~{(payloadBytes / 1024).toFixed(1)} KiB of 1024 KiB K8s limit.
          </p>
          <div className="flex flex-col gap-1.5">
            <Label>Bulk paste (optional, KEY=value per line)</Label>
            <Textarea
              placeholder={'DB_HOST=db.internal\nDB_PASSWORD=s3cret'}
              rows={3}
              className="font-mono text-xs"
              onChange={(ev) => {
                const lines = ev.target.value.split('\n');
                const parsed: Entry[] = [];
                for (const line of lines) {
                  const idx = line.indexOf('=');
                  if (idx <= 0) continue;
                  parsed.push({
                    id: nextId++,
                    key: line.slice(0, idx).trim(),
                    value: line.slice(idx + 1),
                    revealed: false,
                  });
                }
                if (parsed.length > 0) {
                  setEntries((prev) => {
                    const nonEmpty = prev.filter((e) => e.key.trim() !== '');
                    return [...nonEmpty, ...parsed];
                  });
                  ev.target.value = '';
                  toast.success(`Added ${parsed.length} entries from bulk paste`);
                }
              }}
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-2">
        <Button type="submit" variant="primary" loading={saving} disabled={overLimit}>
          {mode === 'create' ? 'Create secret' : 'Save changes'}
        </Button>
        <Button type="button" variant="secondary" appearance="outline" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
