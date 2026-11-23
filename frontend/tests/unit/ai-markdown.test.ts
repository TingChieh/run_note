import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown } from '../../src/lib/ai/markdown.ts';

describe('safe markdown parser', () => {
  it('parses headings, lists, blockquotes, code blocks, tables, and inline emphasis', () => {
    const md = [
      '## 最近四周总结',
      '',
      '你在过去四周完成了 **42.5 km**，配速维持在 `5:30 /km` 左右。',
      '',
      '- 第 1 周：10.2 km',
      '- 第 2 周：*恢复周* 8.0 km',
      '',
      '1. 保持轻松跑比例',
      '2. 循序渐进加量',
      '',
      '> 仅供参考，不构成医疗建议。',
      '',
      '| 周期 | 距离 |',
      '| --- | --- |',
      '| W1 | 10.2 km |',
      '| W2 | 8.0 km |',
      '',
      '```text',
      'pace = duration / distance',
      '```',
    ].join('\n');

    const blocks = parseMarkdown(md);
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'list', 'list', 'blockquote', 'table', 'code']);
    const table = blocks[5];
    expect(table.type === 'table' && table.rows).toHaveLength(2);
    const code = blocks[6];
    expect(code.type === 'code' && code.code).toBe('pace = duration / distance');
  });

  it('neutralizes raw HTML and model-invented links/protocols into plain text tokens', () => {
    const rawHtml = '<script>alert(1)</script> <img src=x onerror=alert(2)>';
    const tokens = parseInline(rawHtml);
    expect(tokens).toEqual([{ type: 'text', text: rawHtml }]);

    const unsafeLink = '点击 [恶意链接](javascript:alert(1)) 或 [伪造活动](/activities/fake-id) 或 [data](data:text/html,hi)';
    const linkTokens = parseInline(unsafeLink);
    expect(linkTokens).toEqual([{ type: 'text', text: '点击 恶意链接 或 伪造活动 或 data' }]);
  });
});
