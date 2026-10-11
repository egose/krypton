'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { IconHistory, IconRotateClockwise } from '@tabler/icons-react';
import { Button } from '@egose/shadcn-theme/components/ui/button';
import { Badge } from '@egose/shadcn-theme/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@egose/shadcn-theme/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@egose/shadcn-theme/components/ui/dialog';
import { api } from '@/lib/api-client';
import type { SecretVersion } from '@/lib/secrets';
import { RevealValue } from './reveal-value';

interface Props {
  namespace: string;
  name: string;
  currentKeys: string[];
  onRestored: () => void;
}

export function VersionHistory({ namespace, name, currentKeys, onRestored }: Props) {
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState<SecretVersion | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['versions', namespace, name],
    queryFn: () => api.listVersions(namespace, name),
  });

  const restore = useMutation({
    mutationFn: (version: number) => api.restoreVersion(namespace, name, version),
    onSuccess: (res) => {
      toast.success(`Rolled back — now at v${res.secret.version}`);
      queryClient.invalidateQueries({ queryKey: ['secret', namespace, name] });
      queryClient.invalidateQueries({ queryKey: ['versions', namespace, name] });
      setConfirm(null);
      onRestored();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const versions = data?.versions ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <IconHistory size={18} /> Version history
          <Badge variant="secondary" size="sm">
            {versions.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">
          Kubernetes overwrites secrets in place — Krypton keeps a restorable snapshot (a separate Secret object) before
          every change.
        </p>
        {isLoading && <p className="text-sm text-muted-foreground">Loading history…</p>}
        {!isLoading && versions.length === 0 && (
          <p className="text-sm text-muted-foreground">No snapshots yet. The first edit will create v1 here.</p>
        )}
        {versions.map((v) => {
          const added = v.keys.filter((k) => !currentKeys.includes(k));
          const removed = currentKeys.filter((k) => !v.keys.includes(k));
          return (
            <div key={v.snapshotName} className="rounded-md border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="primary" appearance="outline" size="sm">
                  v{v.version}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {v.snapshotAt ? new Date(v.snapshotAt).toLocaleString() : '—'}
                  {v.snapshotBy ? ` · by ${v.snapshotBy}` : ''}
                </span>
                <div className="flex-1" />
                <Button variant="warning" appearance="outline" size="sm" onClick={() => setConfirm(v)}>
                  <IconRotateClockwise size={14} /> Restore
                </Button>
              </div>
              {(added.length > 0 || removed.length > 0) && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {added.length > 0 && <>keys only in snapshot: {added.join(', ')} </>}
                  {removed.length > 0 && <>keys removed since: {removed.join(', ')}</>}
                </p>
              )}
              <div className="mt-2 flex flex-col gap-1.5">
                {v.keys.map((k) => (
                  <div key={k} className="flex items-center gap-2">
                    <code className="w-40 shrink-0 truncate font-mono text-xs font-medium">{k}</code>
                    <RevealValue value={v.data[k] ?? ''} keyName={k} />
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </CardContent>

      <Dialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restore v{confirm?.version}?</DialogTitle>
            <DialogDescription>
              The current state will first be snapshotted, so this rollback is itself reversible. Consumers using
              environment variables will need a rollout restart afterwards.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" appearance="outline" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="warning"
              loading={restore.isPending}
              onClick={() => confirm && restore.mutate(confirm.version)}
            >
              Restore v{confirm?.version}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
