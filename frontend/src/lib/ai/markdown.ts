// Safe, dependency-free Markdown AST parser for AI assistant replies.
// Never produces HTML strings: callers render tokens declaratively in Svelte so raw HTML,
// event handlers, and model-invented URLs/protocols can never execute or become clickable links.

export type InlineToken =
  | { type: 'text'; text: string }
  | { type: 'strong'; text: string }
  | { type: 'em'; text: string }
  | { type: 'code'; text: string };

export type MarkdownBlock =
  | { type: 'heading'; level: 1 | 2 | 3; tokens: InlineToken[] }
  | { type: 'paragraph'; lines: InlineToken[][] }
  | { type: 'list'; ordered: boolean; items: InlineToken[][] }
  | { type: 'blockquote'; lines: InlineToken[][] }
  | { type: 'code'; lang: string; code: string }
  | { type: 'table'; headers: InlineToken[][]; rows: InlineToken[][][] }
  | { type: 'hr' };

export function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let i = 0;
  let plain = '';
  const flush = () => {
    if (plain) {
      tokens.push({ type: 'text', text: plain });
      plain = '';
    }
  };

  while (i < text.length) {
    // Inline code: `code`
    if (text[i] === '`') {
      const end = text.indexOf('`', i + 1);
      if (end > i + 1) {
        flush();
        tokens.push({ type: 'code', text: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    // Markdown link [label](url): strip URL (supporting balanced parens) and keep only label text so model cannot invent or inject links.
    if (text[i] === '[') {
      const closeBracket = text.indexOf(']', i + 1);
      if (closeBracket > i + 1 && text[closeBracket + 1] === '(') {
        let depth = 1;
        let p = closeBracket + 2;
        while (p < text.length && depth > 0) {
          if (text[p] === '(') depth++;
          else if (text[p] === ')') depth--;
          p++;
        }
        if (depth === 0 && p > closeBracket + 3) {
          const label = text.slice(i + 1, closeBracket);
          plain += label;
          i = p;
          continue;
        }
      }
    }

    // Bold: **text**
    if (text[i] === '*' && text[i + 1] === '*') {
      const end = text.indexOf('**', i + 2);
      if (end > i + 2) {
        flush();
        tokens.push({ type: 'strong', text: text.slice(i + 2, end) });
        i = end + 2;
        continue;
      }
    }

    // Italic: *text* (avoid matching standalone bullet or spaces)
    if (text[i] === '*' && text[i + 1] !== '*' && text[i + 1] !== ' ') {
      const end = text.indexOf('*', i + 1);
      if (end > i + 1 && text[end - 1] !== ' ') {
        flush();
        tokens.push({ type: 'em', text: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    plain += text[i++];
  }

  flush();
  return tokens;
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((cell) => cell.trim());
}

function isTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes('|') && !trimmed.includes('-')) return false;
  const cells = splitTableRow(trimmed);
  return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isBlockStarter(lines: string[], index: number): boolean {
  const line = lines[index];
  if (!line.trim()) return true;
  if (/^```/.test(line.trim())) return true;
  if (/^#{1,6}\s+/.test(line.trim())) return true;
  if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) return true;
  if (/^>\s?/.test(line.trim())) return true;
  if (/^([-*+•])\s+/.test(line.trim())) return true;
  if (/^\d+\.\s+/.test(line.trim())) return true;
  if (line.includes('|') && index + 1 < lines.length && isTableSeparator(lines[index + 1])) return true;
  return false;
}

export function parseMarkdown(source: string): MarkdownBlock[] {
  const normalized = source.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    // Fenced code block
    const fence = /^```([a-zA-Z0-9_-]*)\s*$/.exec(trimmed);
    if (fence) {
      const lang = fence[1] ?? '';
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i].trim())) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++;
      blocks.push({ type: 'code', lang, code: codeLines.join('\n') });
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    // Heading
    const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (heading) {
      const level = Math.min(3, heading[1].length) as 1 | 2 | 3;
      blocks.push({ type: 'heading', level, tokens: parseInline(heading[2].trim()) });
      i++;
      continue;
    }

    // Table
    if (trimmed.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const headerCells = splitTableRow(trimmed);
      i += 2;
      const rows: InlineToken[][][] = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
        const rowCells = splitTableRow(lines[i]);
        const normalizedRow = headerCells.map((_, col) => parseInline(rowCells[col] ?? ''));
        rows.push(normalizedRow);
        i++;
      }
      blocks.push({
        type: 'table',
        headers: headerCells.map((cell) => parseInline(cell)),
        rows,
      });
      continue;
    }

    // Blockquote
    if (/^>\s?/.test(trimmed)) {
      const quoteLines: InlineToken[][] = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        quoteLines.push(parseInline(lines[i].trim().replace(/^>\s?/, '')));
        i++;
      }
      blocks.push({ type: 'blockquote', lines: quoteLines });
      continue;
    }

    // Unordered list
    if (/^([-*+•])\s+/.test(trimmed)) {
      const items: InlineToken[][] = [];
      while (i < lines.length && /^([-*+•])\s+/.test(lines[i].trim())) {
        items.push(parseInline(lines[i].trim().replace(/^([-*+•])\s+/, '')));
        i++;
      }
      blocks.push({ type: 'list', ordered: false, items });
      continue;
    }

    // Ordered list
    if (/^\d+\.\s+/.test(trimmed)) {
      const items: InlineToken[][] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(parseInline(lines[i].trim().replace(/^\d+\.\s+/, '')));
        i++;
      }
      blocks.push({ type: 'list', ordered: true, items });
      continue;
    }

    // Paragraph
    const paraLines: InlineToken[][] = [];
    while (i < lines.length && !isBlockStarter(lines, i)) {
      paraLines.push(parseInline(lines[i]));
      i++;
    }
    if (paraLines.length) blocks.push({ type: 'paragraph', lines: paraLines });
    else i++;
  }

  return blocks;
}
