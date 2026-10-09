'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { SecretForm } from './secret-form';

export function EditSecretView({ namespace, name }: { namespace: string; name: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['secret', namespace, name],
    queryFn: () => api.getSecret(namespace, name),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading secret…</p>;
  if (error || !data) {
    return (
      <p className="text-sm text-destructive">{error instanceof Error ? error.message : 'Failed to load secret'}</p>
    );
  }
  return <SecretForm key={data.secret.resourceVersion} mode="edit" namespace={namespace} initial={data.secret} />;
}
