'use client';

import { useQuery } from '@tanstack/react-query';
import { IconBox } from '@tabler/icons-react';
import { Badge } from '@egose/shadcn-theme/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@egose/shadcn-theme/components/ui/select';
import { api } from '@/lib/api-client';

interface Props {
  value: string;
  onChange: (ns: string) => void;
}

export function NamespaceSelector({ value, onChange }: Props) {
  const { data, isLoading } = useQuery({ queryKey: ['namespaces'], queryFn: api.namespaces });

  return (
    <div className="flex items-center gap-2">
      <IconBox size={16} className="text-muted-foreground" />
      <Select value={value} onValueChange={onChange} disabled={isLoading}>
        <SelectTrigger className="w-[220px]">
          <SelectValue placeholder={isLoading ? 'Loading…' : 'Select namespace'} />
        </SelectTrigger>
        <SelectContent>
          {(data?.namespaces ?? []).map((ns) => (
            <SelectItem key={ns} value={ns}>
              {ns}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {data && (
        <Badge variant={data.scope === 'cluster' ? 'info' : 'secondary'}>
          {data.scope === 'cluster' ? 'cluster scope' : 'namespace scope'}
        </Badge>
      )}
    </div>
  );
}
