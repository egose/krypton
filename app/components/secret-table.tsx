'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { IconChevronRight, IconSearch } from '@tabler/icons-react';
import { Badge } from '@egose/shadcn-theme/components/ui/badge';
import { Input } from '@egose/shadcn-theme/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@egose/shadcn-theme/components/ui/table';
import type { SecretSummary } from '@/lib/secrets';

export function SecretTable({ namespace, secrets }: { namespace: string; secrets: SecretSummary[] }) {
  const [filter, setFilter] = useState('');

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const filtered = q
      ? secrets.filter(
          (s) =>
            s.name.toLowerCase().includes(q) ||
            s.description.toLowerCase().includes(q) ||
            s.keys.some((k) => k.toLowerCase().includes(q)),
        )
      : [...secrets];
    filtered.sort((a, b) => a.name.localeCompare(b.name));
    return filtered;
  }, [secrets, filter]);

  return (
    <div className="flex flex-col gap-3">
      <div className="relative max-w-sm">
        <IconSearch size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Filter secrets…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="pl-8"
        />
      </div>
      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Keys</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Description</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                  No secrets found{filter ? ` matching "${filter}"` : ''} in this namespace.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((s) => (
                <TableRow key={s.name}>
                  <TableCell>
                    <Link
                      href={`/secrets/${namespace}/${s.name}`}
                      className="font-medium text-primary underline-offset-4 hover:underline"
                    >
                      {s.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" appearance="outline" size="sm">
                      {s.type}
                    </Badge>
                  </TableCell>
                  <TableCell>{s.keyCount}</TableCell>
                  <TableCell>{s.version > 0 ? `v${s.version}` : '—'}</TableCell>
                  <TableCell>
                    <span className="text-muted-foreground">{s.description || '—'}</span>
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/secrets/${namespace}/${s.name}`}
                      className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
                    >
                      Open <IconChevronRight size={14} />
                    </Link>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">
        {secrets.length} secret{secrets.length === 1 ? '' : 's'} · historical snapshots are hidden from this list
      </p>
    </div>
  );
}
