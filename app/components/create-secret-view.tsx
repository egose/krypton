'use client';

import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { IconArrowLeft } from '@tabler/icons-react';
import { Button } from '@egose/shadcn-theme/components/ui/button';
import { Alert } from '@egose/shadcn-theme/components/ui/alert';
import { api } from '@/lib/api-client';
import { SecretForm } from './secret-form';

/**
 * Guards the create form: when the namespace rules exclude the current user,
 * explain upfront instead of letting them fill the form and fail on submit.
 * (The POST endpoint still enforces this server-side; this is purely UX.)
 */
export function CreateSecretView({ namespace }: { namespace: string }) {
  const router = useRouter();
  const { data, isLoading, error } = useQuery({
    // Shared with the dashboard — no extra fetch when navigating from there.
    queryKey: ['secrets', namespace],
    queryFn: () => api.listSecrets(namespace),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error) {
    return (
      <p className="text-sm text-destructive">{error instanceof Error ? error.message : 'Failed to load namespace'}</p>
    );
  }
  if (data && !data.canCreate) {
    return (
      <div className="flex flex-col gap-3">
        <Alert variant="warning">
          <div>
            You are not allowed to create secrets in &ldquo;{namespace}&rdquo;. Creation is controlled by the namespace
            rules in the <code>krypton-access</code> ConfigMap — per-secret allowed groups/users only take effect{' '}
            <em>after</em> a secret exists, so they can&apos;t grant creation.
          </div>
        </Alert>
        <div>
          <Button variant="secondary" appearance="outline" size="sm" onClick={() => router.back()}>
            <IconArrowLeft size={14} /> Back
          </Button>
        </div>
      </div>
    );
  }
  return <SecretForm mode="create" namespace={namespace} />;
}
