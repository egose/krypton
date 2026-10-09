import { Suspense } from 'react';
import { LoginView } from '@/components/login-view';

export default function LoginPage() {
  return (
    <Suspense fallback={<p className="pt-16 text-center text-sm text-muted-foreground">Loading…</p>}>
      <LoginView />
    </Suspense>
  );
}
