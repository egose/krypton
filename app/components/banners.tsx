'use client';

import { useQuery } from '@tanstack/react-query';
import { IconAlertTriangle, IconFlask } from '@tabler/icons-react';
import { Alert } from '@egose/shadcn-theme/components/ui/alert';
import { api } from '@/lib/api-client';

export function Banners() {
  const { data } = useQuery({ queryKey: ['public-config'], queryFn: api.config });
  if (!data) return null;
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 pt-3">
      {!data.etcdEncrypted && (
        <Alert variant="warning">
          <IconAlertTriangle size={16} />
          <div>
            <strong>etcd encryption at rest is not enabled.</strong>{' '}
            <span className="opacity-90">
              Secrets are only base64-encoded in etcd — enable the API-server encryption provider (e.g. aescbc on
              OpenShift) for true cryptographic protection.
            </span>
          </div>
        </Alert>
      )}
      {data.authDisabled && (
        <Alert variant="info">
          <IconFlask size={16} />
          <div>
            <strong>Auth disabled (local dev).</strong>{' '}
            <span className="opacity-90">Running as a mock admin. Configure OIDC SSO for any shared deployment.</span>
          </div>
        </Alert>
      )}
    </div>
  );
}
