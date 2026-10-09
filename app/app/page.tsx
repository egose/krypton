import { Suspense } from 'react';
import { Dashboard } from '@/components/dashboard';

export default function Home() {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
      <Dashboard />
    </Suspense>
  );
}
