/** Content types for secret values, shown in the per-row value dialog. */
export type ValueContentType = 'json' | 'yaml' | 'markdown' | 'pem' | 'xml' | 'text';

export const VALUE_CONTENT_TYPES: { value: ValueContentType; label: string }[] = [
  { value: 'json', label: 'JSON' },
  { value: 'yaml', label: 'YAML' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'pem', label: 'PEM' },
  { value: 'xml', label: 'XML' },
  { value: 'text', label: 'Text' },
];

export function contentTypeLabel(type: ValueContentType): string {
  return VALUE_CONTENT_TYPES.find((t) => t.value === type)?.label ?? 'Text';
}

// Skip expensive parsing above this size (cheap prefix checks still run).
const PARSE_BUDGET = 256 * 1024;

function keyHint(keyName: string): ValueContentType | null {
  const k = keyName.toLowerCase();
  if (k === '.dockerconfigjson' || k.endsWith('.json')) return 'json';
  if (k.endsWith('.yaml') || k.endsWith('.yml')) return 'yaml';
  if (k.endsWith('.md') || k.endsWith('.markdown')) return 'markdown';
  if (
    k.endsWith('.pem') ||
    k.endsWith('.crt') ||
    k.endsWith('.key') ||
    k === 'tls.crt' ||
    k === 'tls.key' ||
    k === 'ssh-privatekey'
  )
    return 'pem';
  if (k.endsWith('.xml')) return 'xml';
  return null;
}

/**
 * Best-effort content-type detection for a secret value. Strong content
 * signals win over key-name hints; weak heuristics come last. Anything
 * unrecognized is `text` — detection never fails.
 */
export function detectContentType(keyName: string, value: string): ValueContentType {
  const trimmed = value.trim();
  if (!trimmed) return 'text';

  // Strong signals from content (checked before key hints). JSON requires
  // object/array shape so plain scalars like `12345` stay `text`.
  if (value.length <= PARSE_BUDGET && (trimmed.startsWith('{') || trimmed.startsWith('['))) {
    try {
      JSON.parse(trimmed);
      return 'json';
    } catch {
      // fall through to other detectors
    }
  }
  if (trimmed.includes('-----BEGIN ')) return 'pem';
  if (/^<[\w?!][^<>]*>/.test(trimmed)) return 'xml';

  // Key-name hints (e.g. config.json, tls.crt).
  const hint = keyHint(keyName);
  if (hint) return hint;

  // Strong Markdown-only signals (no YAML equivalent).
  if (/```/.test(value) || /\[[^\]\n]+\]\([^)\n]+\)/.test(value)) return 'markdown';

  // YAML structure wins over `# `-style lines: a `# comment` above a mapping
  // is YAML, not a Markdown heading.
  const yamlLines = value.split('\n').filter((l) => /^\s*[\w.-]+\s*:/.test(l));
  if (trimmed.startsWith('---') || yamlLines.length >= 2) return 'yaml';

  // Weak Markdown signal (checked last — see above).
  if (/^#{1,6} /m.test(value)) return 'markdown';

  return 'text';
}
