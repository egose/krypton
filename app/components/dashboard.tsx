'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { IconPlus } from '@tabler/icons-react';
import { Button } from '@egose/shadcn-theme/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@egose/shadcn-theme/components/ui/card';
import { api } from '@/lib/api-client';
import { NamespaceSelector } from './namespace-selector';
import { SecretTable } from './secret-table';

export function Dashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nsQuery = useQuery({ queryKey: ['namespaces'], queryFn: api.namespaces });

  // Derived state: URL param wins, otherwise first allowed namespace.
  // No useState/useEffect needed — the URL is the source of truth.
  const namespaces = nsQuery.data?.namespaces ?? [];
  const fromUrl = searchParams.get('ns');
  const namespace = fromUrl ?? namespaces[0] ?? '';

  const secretsQuery = useQuery({
    queryKey: ['secrets', namespace],
    queryFn: () => api.listSecrets(namespace),
    enabled: Boolean(namespace),
  });
  // undefined while loading — only an explicit false disables creation.
  const canCreate = secretsQuery.data?.canCreate;

  const pick = (ns: string) => {
    router.replace(`/?ns=${encodeURIComponent(ns)}`, { scroll: false });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <NamespaceSelector value={namespace} onChange={pick} />
        <div className="flex-1" />
        {canCreate === false && (
          <span className="text-xs text-muted-foreground">
            Namespace rules don&apos;t allow you to create secrets here.
          </span>
        )}
        <Button
          variant="primary"
          size="sm"
          disabled={!namespace || canCreate === false}
          title={
            canCreate === false
              ? `You are not allowed to create secrets in "${namespace}" (namespace rules in the krypton-access ConfigMap)`
              : undefined
          }
          onClick={() => namespace && router.push(`/secrets/${namespace}/new`)}
        >
          <IconPlus size={15} /> New secret
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Secrets{namespace ? ` in ${namespace}` : ''}</CardTitle>
        </CardHeader>
        <CardContent>
          {!namespace && <p className="text-sm text-muted-foreground">Select a namespace.</p>}
          {namespace && secretsQuery.isLoading && <p className="text-sm text-muted-foreground">Loading secrets…</p>}
          {namespace && secretsQuery.error && (
            <p className="text-sm text-destructive">{(secretsQuery.error as Error).message}</p>
          )}
          {namespace && secretsQuery.data && <SecretTable namespace={namespace} secrets={secretsQuery.data.secrets} />}
        </CardContent>
      </Card>
    </div>
  );
}
