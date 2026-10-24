import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect, it } from 'vitest';

const root = join(import.meta.dirname, '../..');
const sources = [join(root, 'src'), join(root, 'tests/fixtures')];

function files(dir: string, suffixes: string[]): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const info = statSync(path);
    if (info.isDirectory()) found.push(...files(path, suffixes));
    else if (suffixes.some(suffix => path.endsWith(suffix))) found.push(path);
  }
  return found;
}

function stylesOf(path: string, text: string): string {
  if (path.endsWith('.css')) return text;
  return [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(match => match[1]).join('\n');
}

function declarations(css: string, property: string): string[] {
  const values: string[] = [];
  const pattern = new RegExp(`(?:^|[^\\w-])${property}\\s*:\\s*([^;}{]+)`, 'g');
  for (const match of css.matchAll(pattern)) values.push(match[1].trim());
  return values;
}

const styles = files(sources[0], ['.css', '.svelte'])
  .concat(files(sources[1], ['.css', '.svelte']))
  .map(path => ({ path: relative(root, path), css: stylesOf(path, readFileSync(path, 'utf8')) }));

it('keeps font-size, weight, tracking and line-height on the type scale', () => {
  const problems: string[] = [];
  for (const file of styles) {
    for (const value of declarations(file.css, 'font-size')) {
      if (!/^var\(--text-[a-z-]+\)$/.test(value)) problems.push(`${file.path} font-size: ${value}`);
    }
    for (const value of declarations(file.css, 'font-weight')) {
      const weight = value.replace(/\s*!important$/, '');
      if (!/^var\(--weight-[a-z-]+\)$/.test(weight) && !['inherit', 'normal', 'bold'].includes(weight)) {
        problems.push(`${file.path} font-weight: ${value}`);
      }
    }
    for (const value of declarations(file.css, 'letter-spacing')) {
      if (value.startsWith('-') || !(/^(0|inherit|normal|var\(--tracking-[a-z-]+\))$/.test(value))) {
        problems.push(`${file.path} letter-spacing: ${value}`);
      }
    }
    for (const value of declarations(file.css, 'line-height')) {
      if (!/^var\(--line-height-[a-z-]+\)$/.test(value) && !['inherit', 'normal'].includes(value)) {
        problems.push(`${file.path} line-height: ${value}`);
      }
    }
  }
  expect(problems).toEqual([]);
});

it('does not use off-scale weights in poster canvas text', () => {
  const problems: string[] = [];
  for (const path of files(join(root, 'src/lib/share'), ['.ts'])) {
    const text = readFileSync(path, 'utf8');
    for (const match of text.matchAll(/,\s*(550|650|750|800)\b/g)) {
      problems.push(`${relative(root, path)} uses weight ${match[1]}`);
    }
  }
  expect(problems).toEqual([]);
});

it('does not use arbitrary Tailwind type utilities', () => {
  const problems: string[] = [];
  for (const path of files(sources[0], ['.svelte']).concat(files(sources[1], ['.svelte']))) {
    const text = readFileSync(path, 'utf8');
    for (const match of text.matchAll(/\b(?:text|font|leading|tracking)-\[[^\]]+\]|\bfont-(?:thin|extralight|light|extrabold|black)\b/g)) {
      problems.push(`${relative(root, path)} ${match[0]}`);
    }
  }
  expect(problems).toEqual([]);
});
