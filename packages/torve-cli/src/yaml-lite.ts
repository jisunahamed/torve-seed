export function yamlScalar(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function unquoteYamlScalar(raw: string): string {
  const trimmed = raw.trim();
  const dq = trimmed.match(/^"((?:[^"\\]|\\.)*)"(?:\s*#.*)?$/);
  if (dq) return dq[1]!.replace(/\\(.)/g, '$1');
  const sq = trimmed.match(/^'([^']*)'(?:\s*#.*)?$/);
  if (sq) return sq[1]!;
  return trimmed.split('#')[0]!.trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function yamlTopLevelKeyIndex(lines: readonly string[], key: string): number {
  const pattern = new RegExp(`^${escapeRegExp(key)}\\s*:`);
  return lines.findIndex((line) => pattern.test(line));
}

export function readFlatYamlKey(raw: string, key: string): string | undefined {
  const lines = raw.split(/\r?\n/);
  const idx = yamlTopLevelKeyIndex(lines, key);
  if (idx === -1) return undefined;
  const line = lines[idx]!;
  return unquoteYamlScalar(line.slice(line.indexOf(':') + 1));
}

export function setFlatYamlKeys(raw: string, entries: ReadonlyArray<[string, string]>): string {
  const lines = raw.length > 0 ? raw.split(/\r?\n/) : [];
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines.pop();
  for (const [key, value] of entries) {
    const assignment = `${key}: ${yamlScalar(value)}`;
    const idx = yamlTopLevelKeyIndex(lines, key);
    if (idx !== -1) lines[idx] = assignment;
    else lines.push(assignment);
  }
  return `${lines.join('\n')}\n`;
}

export function removeFlatYamlKeys(raw: string, keys: readonly string[]): { content: string; changed: boolean } {
  let lines = raw.length > 0 ? raw.split(/\r?\n/) : [];
  let changed = false;
  for (const key of keys) {
    const idx = yamlTopLevelKeyIndex(lines, key);
    if (idx !== -1) {
      lines = [...lines.slice(0, idx), ...lines.slice(idx + 1)];
      changed = true;
    }
  }
  if (!changed) return { content: raw, changed: false };
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines.pop();
  return { content: lines.length > 0 ? `${lines.join('\n')}\n` : '', changed: true };
}

function findBlockEnd(lines: readonly string[], startIdx: number, parentIndent: number): number {
  let i = startIdx + 1;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === '' || line.trim().startsWith('#')) {
      i++;
      continue;
    }
    const indent = line.match(/^(\s*)/)?.[1]?.length ?? 0;
    if (indent <= parentIndent) break;
    i++;
  }
  return i;
}

function findChildKeyIndex(lines: readonly string[], startIdx: number, endIdx: number, childIndent: number, key: string): number {
  const pattern = new RegExp(`^\\s{${childIndent}}${escapeRegExp(key)}\\s*:`);
  for (let i = startIdx; i < endIdx; i++) {
    if (pattern.test(lines[i]!)) return i;
  }
  return -1;
}

function detectChildIndent(lines: readonly string[], parentIdx: number, endIdx: number, fallback = 2): number {
  for (let i = parentIdx + 1; i < endIdx; i++) {
    const line = lines[i]!;
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    const indent = line.match(/^(\s*)/)?.[1]?.length ?? 0;
    if (indent > 0) return indent;
  }
  return fallback;
}

export function applyHermesYamlPatch(
  raw: string,
  opts: { providerKey: string; baseURL: string; modelAlias: string; contextWindow: number },
): string {
  let lines = raw.length > 0 ? raw.split(/\r?\n/) : [];
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines.pop();

  // 1) providers.<providerKey>
  const providersHeader = yamlTopLevelKeyIndex(lines, 'providers');
  const providerBlock = (indent: number): string[] => {
    const pad = ' '.repeat(indent);
    const pad2 = ' '.repeat(indent + 2);
    const pad3 = ' '.repeat(indent + 4);
    const pad4 = ' '.repeat(indent + 6);
    return [
      `${pad}${opts.providerKey}:`,
      `${pad2}name: Torve`,
      `${pad2}api: ${yamlScalar(opts.baseURL)}`,
      `${pad2}transport: chat_completions`,
      `${pad2}extra_headers:`,
      `${pad3}originator: hermes`,
      `${pad2}default_model: ${opts.modelAlias}`,
      `${pad2}models:`,
      `${pad3}${opts.modelAlias}:`,
      `${pad4}context_length: ${opts.contextWindow}`,
    ];
  };

  if (providersHeader === -1) {
    lines.push('providers:', ...providerBlock(2));
  } else {
    const headerLine = lines[providersHeader]!;
    const afterColon = headerLine.slice(headerLine.indexOf(':') + 1).trim();
    if (afterColon === '{}' || afterColon === 'null' || afterColon === '~') {
      lines[providersHeader] = 'providers:';
    }
    const end = findBlockEnd(lines, providersHeader, 0);
    const indent = detectChildIndent(lines, providersHeader, end, 2);
    const existingProvider = findChildKeyIndex(lines, providersHeader + 1, end, indent, opts.providerKey);
    if (existingProvider !== -1) {
      const pEnd = findBlockEnd(lines, existingProvider, indent);
      lines = [...lines.slice(0, existingProvider), ...providerBlock(indent), ...lines.slice(pEnd)];
    } else {
      lines = [...lines.slice(0, end), ...providerBlock(indent), ...lines.slice(end)];
    }
  }

  // 2) model.{provider, default, base_url, api_mode}
  const modelHeader = yamlTopLevelKeyIndex(lines, 'model');
  const modelFields: ReadonlyArray<[string, string]> = [
    ['provider', opts.providerKey],
    ['default', opts.modelAlias],
    ['base_url', '""'],
    ['api_mode', 'chat_completions'],
  ];
  if (modelHeader === -1) {
    lines.push('model:');
    for (const [k, v] of modelFields) lines.push(`  ${k}: ${v}`);
  } else {
    const headerLine = lines[modelHeader]!;
    const afterColon = headerLine.slice(headerLine.indexOf(':') + 1).trim();
    if (afterColon === '{}' || afterColon === 'null' || afterColon === '~') {
      lines[modelHeader] = 'model:';
    }
    let end = findBlockEnd(lines, modelHeader, 0);
    const indent = detectChildIndent(lines, modelHeader, end, 2);
    const pad = ' '.repeat(indent);
    for (const [k, v] of modelFields) {
      const idx = findChildKeyIndex(lines, modelHeader + 1, end, indent, k);
      if (idx !== -1) {
        lines[idx] = `${pad}${k}: ${v}`;
      } else {
        lines = [...lines.slice(0, end), `${pad}${k}: ${v}`, ...lines.slice(end)];
        end++;
      }
    }
  }

  return `${lines.join('\n')}\n`;
}

export function readHermesProviderApi(raw: string, providerKey: string): string | undefined {
  const lines = raw.split(/\r?\n/);
  const providersHeader = yamlTopLevelKeyIndex(lines, 'providers');
  if (providersHeader === -1) return undefined;
  const end = findBlockEnd(lines, providersHeader, 0);
  const indent = detectChildIndent(lines, providersHeader, end, 2);
  const pIdx = findChildKeyIndex(lines, providersHeader + 1, end, indent, providerKey);
  if (pIdx === -1) return undefined;
  const pEnd = findBlockEnd(lines, pIdx, indent);
  const childIndent = detectChildIndent(lines, pIdx, pEnd, indent + 2);
  const apiIdx = findChildKeyIndex(lines, pIdx + 1, pEnd, childIndent, 'api');
  if (apiIdx === -1) return undefined;
  const line = lines[apiIdx]!;
  return unquoteYamlScalar(line.slice(line.indexOf(':') + 1));
}

export function removeHermesYamlPatch(
  raw: string,
  providerKey: string,
  isManagedApi: (api: string | undefined) => boolean,
): { content: string; changed: boolean } {
  const api = readHermesProviderApi(raw, providerKey);
  if (!isManagedApi(api)) return { content: raw, changed: false };

  let lines = raw.split(/\r?\n/);
  let changed = false;

  const providersHeader = yamlTopLevelKeyIndex(lines, 'providers');
  if (providersHeader !== -1) {
    const end = findBlockEnd(lines, providersHeader, 0);
    const indent = detectChildIndent(lines, providersHeader, end, 2);
    const pIdx = findChildKeyIndex(lines, providersHeader + 1, end, indent, providerKey);
    if (pIdx !== -1) {
      const pEnd = findBlockEnd(lines, pIdx, indent);
      lines = [...lines.slice(0, pIdx), ...lines.slice(pEnd)];
      changed = true;
      const newEnd = findBlockEnd(lines, providersHeader, 0);
      const hasRemaining = lines.slice(providersHeader + 1, newEnd).some((l) => l.trim() && !l.trim().startsWith('#'));
      if (!hasRemaining) {
        lines = [...lines.slice(0, providersHeader), ...lines.slice(newEnd)];
      }
    }
  }

  const modelHeader = yamlTopLevelKeyIndex(lines, 'model');
  if (modelHeader !== -1) {
    const end = findBlockEnd(lines, modelHeader, 0);
    const indent = detectChildIndent(lines, modelHeader, end, 2);
    const provIdx = findChildKeyIndex(lines, modelHeader + 1, end, indent, 'provider');
    const provVal = provIdx !== -1 ? unquoteYamlScalar(lines[provIdx]!.slice(lines[provIdx]!.indexOf(':') + 1)) : undefined;
    if (provVal === providerKey) {
      const toRemove = new Set(['provider', 'default', 'base_url', 'api_mode']);
      const kept: string[] = [];
      for (let i = modelHeader + 1; i < end; i++) {
        const line = lines[i]!;
        const m = line.match(new RegExp(`^\\s{${indent}}([A-Za-z0-9_]+)\\s*:`));
        if (m && toRemove.has(m[1]!)) {
          changed = true;
          continue;
        }
        kept.push(line);
      }
      const hasRemaining = kept.some((l) => l.trim() && !l.trim().startsWith('#'));
      if (hasRemaining) {
        lines = [...lines.slice(0, modelHeader + 1), ...kept, ...lines.slice(end)];
      } else {
        lines = [...lines.slice(0, modelHeader), ...lines.slice(end)];
      }
    }
  }

  if (!changed) return { content: raw, changed: false };
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines.pop();
  return { content: lines.length > 0 ? `${lines.join('\n')}\n` : '', changed: true };
}

export interface ContinueYamlModelEntry {
  name: string;
  provider: string;
  model: string;
  apiBase: string;
  apiKey: string;
}

function splitYamlListItems(blockLines: readonly string[]): string[][] {
  const items: string[][] = [];
  let current: string[] | null = null;
  let listIndent = -1;
  for (const line of blockLines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      if (current) current.push(line);
      continue;
    }
    const match = line.match(/^(\s*)-\s*(.*)$/);
    if (match) {
      const indent = match[1]!.length;
      if (listIndent === -1 || indent <= listIndent) {
        listIndent = indent;
        if (current) items.push(current);
        current = [line];
        continue;
      }
    }
    if (current) current.push(line);
  }
  if (current) items.push(current);
  return items;
}

function isTorveContinueYamlItem(itemLines: readonly string[]): boolean {
  for (const line of itemLines) {
    const m = line.match(/^\s*(?:-\s*)?name\s*:\s*(.+)$/);
    if (m) {
      return unquoteYamlScalar(m[1]!).startsWith('Torve · ');
    }
  }
  return false;
}

function serializeContinueYamlEntry(entry: ContinueYamlModelEntry): string[] {
  return [
    `  - name: ${yamlScalar(entry.name)}`,
    `    provider: ${entry.provider}`,
    `    model: ${yamlScalar(entry.model)}`,
    `    apiBase: ${yamlScalar(entry.apiBase)}`,
    `    apiKey: ${yamlScalar(entry.apiKey)}`,
  ];
}

export function applyContinueYamlPatch(raw: string, entries: readonly ContinueYamlModelEntry[]): string {
  let lines = raw.length > 0 ? raw.split(/\r?\n/) : [];
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines.pop();

  const modelsIdx = yamlTopLevelKeyIndex(lines, 'models');
  const serializedEntries = entries.flatMap(serializeContinueYamlEntry);

  if (modelsIdx === -1) {
    lines.push('models:', ...serializedEntries);
    return `${lines.join('\n')}\n`;
  }

  const headerLine = lines[modelsIdx]!;
  const afterColon = headerLine.slice(headerLine.indexOf(':') + 1).trim();
  if (afterColon === '[]' || afterColon === 'null' || afterColon === '~') {
    lines[modelsIdx] = 'models:';
  }
  const end = findBlockEnd(lines, modelsIdx, 0);
  const existingItems = splitYamlListItems(lines.slice(modelsIdx + 1, end));
  const keptLines = existingItems
    .filter((item) => !isTorveContinueYamlItem(item))
    .flat();

  const next = [
    ...lines.slice(0, modelsIdx + 1),
    ...keptLines,
    ...serializedEntries,
    ...lines.slice(end),
  ];
  return `${next.join('\n')}\n`;
}

export function hasContinueYamlTorveEntries(raw: string): boolean {
  const lines = raw.split(/\r?\n/);
  const modelsIdx = yamlTopLevelKeyIndex(lines, 'models');
  if (modelsIdx === -1) return false;
  const end = findBlockEnd(lines, modelsIdx, 0);
  const items = splitYamlListItems(lines.slice(modelsIdx + 1, end));
  return items.some(isTorveContinueYamlItem);
}

export function removeContinueYamlPatch(raw: string): { content: string; changed: boolean } {
  const lines = raw.split(/\r?\n/);
  const modelsIdx = yamlTopLevelKeyIndex(lines, 'models');
  if (modelsIdx === -1) return { content: raw, changed: false };
  const end = findBlockEnd(lines, modelsIdx, 0);
  const existingItems = splitYamlListItems(lines.slice(modelsIdx + 1, end));
  const kept = existingItems.filter((item) => !isTorveContinueYamlItem(item));
  if (kept.length === existingItems.length) return { content: raw, changed: false };

  const keptLines = kept.flat();
  const next = keptLines.length > 0
    ? [...lines.slice(0, modelsIdx + 1), ...keptLines, ...lines.slice(end)]
    : [...lines.slice(0, modelsIdx), 'models: []', ...lines.slice(end)];
  while (next.length > 0 && next[next.length - 1]!.trim() === '') next.pop();
  return { content: `${next.join('\n')}\n`, changed: true };
}
