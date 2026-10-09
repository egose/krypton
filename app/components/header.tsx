'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { IconKey, IconLogout, IconShieldLock } from '@tabler/icons-react';
import { Button, buttonVariants } from '@egose/shadcn-theme/components/ui/button';
import { Badge } from '@egose/shadcn-theme/components/ui/badge';
import { api } from '@/lib/api-client';

export function Header() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const meQuery = useQuery({ queryKey: ['me'], queryFn: api.me, retry: false });
  const user = meQuery.data?.user ?? null;

  const signOut = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      // Drop all cached secrets/session state, then go to login.
      queryClient.clear();
      router.push('/login');
      router.refresh();
    }
  };

  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <IconShieldLock size={18} />
          </span>
          <span className="text-lg tracking-tight">Krypton</span>
          <Badge variant="secondary" className="hidden text-[10px] sm:inline-flex">
            K8s-native secrets
          </Badge>
        </Link>
        <div className="flex-1" />
        {user ? (
          <div className="flex items-center gap-2">
            <div className="hidden text-right text-xs leading-tight md:block">
              <div className="font-medium">{user.name}</div>
              <div className="text-muted-foreground">{user.email}</div>
            </div>
            <Button variant="secondary" appearance="outline" size="sm" onClick={signOut}>
              <IconLogout size={15} />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        ) : (
          <a href="/login" className={buttonVariants({ variant: 'primary', size: 'sm' })}>
            <IconKey size={15} /> Sign in with SSO
          </a>
        )}
      </div>
    </header>
  );
}
