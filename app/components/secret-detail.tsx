'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { IconArrowLeft, IconPencil, IconRefresh, IconRocket, IconTrash } from '@tabler/icons-react';
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
import { Alert } from '@egose/shadcn-theme/components/ui/alert';
import { api } from '@/lib/api-client';
import { RevealValue } from './reveal-value';
import { VersionHistory } from './version-history';

interface Props {
  namespace: string;
  name: string;
}

export function SecretDetail({ namespace, name }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['secret', namespace, name],
    queryFn: () => api.getSecret(namespace, name),
  });

  const del = useMutation({
    mutationFn: () => api.deleteSecret(namespace, name),
    onSuccess: () => {
      toast.success(`Secret "${name}" deleted`);
      router.push(`/?ns=${encodeURIComponent(namespace)}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const restart = useMutation({
    mutationFn: () => api.restartConsumers(namespace, name),
    onSuccess: (res) => {
      const total = res.deployments.length + res.statefulSets.length + res.daemonSets.length;
      toast.success(
        total === 0
          ? 'No direct consumers found — nothing restarted'
          : `Restarted ${total} workload${total === 1 ? '' : 's'}: ${[...res.deployments, ...res.statefulSets, ...res.daemonSets].join(', ')}`,
      );
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading secret…</p>;
  if (error || !data) {
    return (
      <div className="flex flex-col gap-3">
        <Alert variant="danger">
          <div>{error instanceof Error ? error.message : 'Failed to load secret'}</div>
        </Alert>
        <div>
          <Button variant="secondary" appearance="outline" size="sm" onClick={() => router.back()}>
            <IconArrowLeft size={14} /> Back
          </Button>
        </div>
      </div>
    );
  }

  const secret = data.secret;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" appearance="ghost" size="sm" onClick={() => router.back()}>
          <IconArrowLeft size={14} /> Back
        </Button>
        <div className="flex-1" />
        <Button variant="secondary" appearance="outline" size="sm" onClick={() => refetch()}>
          <IconRefresh size={14} /> Reload
        </Button>
        <Button
          variant="info"
          appearance="outline"
          size="sm"
          loading={restart.isPending}
          onClick={() => restart.mutate()}
          title="Rolling-restart Deployments/StatefulSets/DaemonSets that reference this secret"
        >
          <IconRocket size={14} /> Restart consumers
        </Button>
        <Button
          variant="primary"
          appearance="outline"
          size="sm"
          onClick={() => router.push(`/secrets/${namespace}/${name}/edit`)}
        >
          <IconPencil size={14} /> Edit
        </Button>
        <Button variant="danger" appearance="outline" size="sm" onClick={() => setConfirmDelete(true)}>
          <IconTrash size={14} /> Delete
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{secret.name}</span>
            <Badge variant="secondary" appearance="outline" size="sm">
              {secret.namespace}
            </Badge>
            <Badge variant="secondary" appearance="outline" size="sm">
              {secret.type}
            </Badge>
            {secret.version > 0 && (
              <Badge variant="primary" appearance="outline" size="sm">
                v{secret.version}
              </Badge>
            )}
            {!secret.managedByKrypton && (
              <Badge variant="warning" size="sm">
                external (not created by Krypton)
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          {secret.description && <p className="text-muted-foreground">{secret.description}</p>}
          <div className="grid gap-2 text-xs sm:grid-cols-2">
            <div>
              <span className="text-muted-foreground">resourceVersion: </span>
              <code className="font-mono">{secret.resourceVersion}</code>
            </div>
            <div>
              <span className="text-muted-foreground">created: </span>
              {secret.creationTimestamp ? new Date(secret.creationTimestamp).toLocaleString() : '—'}
            </div>
            <div>
              <span className="text-muted-foreground">allowed groups: </span>
              {secret.allowedGroups.length > 0 ? secret.allowedGroups.join(', ') : '— (namespace default)'}
            </div>
            <div>
              <span className="text-muted-foreground">allowed users: </span>
              {secret.allowedUsers.length > 0 ? secret.allowedUsers.join(', ') : '—'}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            Data{' '}
            <Badge variant="secondary" size="sm">
              {secret.keyCount}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {secret.keys.length === 0 && <p className="text-sm text-muted-foreground">This secret has no keys.</p>}
          {secret.keys.map((k) => (
            <div key={k} className="flex items-center gap-2">
              <code className="w-48 shrink-0 truncate font-mono text-xs font-medium">{k}</code>
              <div className="flex-1">
                <RevealValue value={secret.data[k] ?? ''} />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Alert variant="info">
        <div className="text-xs">
          Volume-mounted secrets sync into pods automatically (kubelet delay); pods using environment variables need a{' '}
          <strong>Restart consumers</strong> rollout to pick up new values.
        </div>
      </Alert>

      <VersionHistory
        namespace={namespace}
        name={name}
        currentKeys={secret.keys}
        onRestored={() => queryClient.invalidateQueries({ queryKey: ['secret', namespace, name] })}
      />

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {name}?</DialogTitle>
            <DialogDescription>
              This deletes the Secret object and its Krypton snapshots from namespace <code>{namespace}</code>. This
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" appearance="outline" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button variant="danger" loading={del.isPending} onClick={() => del.mutate()}>
              Delete permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
