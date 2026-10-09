'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { IconKey, IconShieldLock } from '@tabler/icons-react';
import { buttonVariants } from '@egose/shadcn-theme/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@egose/shadcn-theme/components/ui/card';

export function LoginView() {
  const searchParams = useSearchParams();
  const authError = searchParams.get('auth') === 'error';

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 pt-16">
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <IconShieldLock size={24} />
        </span>
        <h1 className="text-2xl font-semibold tracking-tight">Sign in to Krypton</h1>
        <p className="text-sm text-muted-foreground">
          Lightweight secret manager backed directly by Kubernetes Secrets — no database, no volumes.
        </p>
      </div>
      {authError && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          SSO sign-in failed. Check the OIDC configuration and try again.
        </p>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Single sign-on</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <a href="/api/auth/login" className={buttonVariants({ variant: 'primary' })}>
            <IconKey size={16} /> Continue with SSO (OIDC)
          </a>
          <p className="text-xs text-muted-foreground">
            Works with Keycloak, Entra ID, Okta, Google, or any OIDC provider. Users don&apos;t need cluster credentials
            — access is enforced from SSO groups via secret annotations.
          </p>
          <Link href="/" className="text-center text-xs text-muted-foreground underline-offset-4 hover:underline">
            Back to dashboard
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
