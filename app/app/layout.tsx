import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/providers';
import { Header } from '@/components/header';
import { Banners } from '@/components/banners';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Krypton — Kubernetes Secret Manager',
  description:
    'Lightweight secret manager backed directly by Kubernetes Secret objects. No database, no volumes — SSO login, annotation-based access control, and versioned rollbacks.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Providers>
          <Header />
          <Banners />
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
          <footer className="border-t py-4 text-center text-xs text-muted-foreground">
            Krypton · stateless UI over native K8s Secrets · values stay base64 in etcd unless encryption at rest is
            enabled
          </footer>
        </Providers>
      </body>
    </html>
  );
}
