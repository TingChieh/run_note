<script lang="ts">
  import { parseMarkdown, type InlineToken } from '#lib/ai/markdown.ts';

  let { content }: { content: string } = $props();
  const blocks = $derived(parseMarkdown(content));
</script>

{#snippet inline(tokens: InlineToken[])}
  {#each tokens as token}
    {#if token.type === 'strong'}<strong>{token.text}</strong>
    {:else if token.type === 'em'}<em>{token.text}</em>
    {:else if token.type === 'code'}<code class="md-inline-code">{token.text}</code>
    {:else}{token.text}{/if}
  {/each}
{/snippet}

<div class="assistant-md">
  {#each blocks as block}
    {#if block.type === 'heading'}
      {#if block.level === 1}
        <h3 class="md-h1">{@render inline(block.tokens)}</h3>
      {:else if block.level === 2}
        <h4 class="md-h2">{@render inline(block.tokens)}</h4>
      {:else}
        <h5 class="md-h3">{@render inline(block.tokens)}</h5>
      {/if}
    {:else if block.type === 'paragraph'}
      <p class="md-p">
        {#each block.lines as line, idx}
          {#if idx > 0}<br />{/if}{@render inline(line)}
        {/each}
      </p>
    {:else if block.type === 'list'}
      {#if block.ordered}
        <ol class="md-list md-ol">
          {#each block.items as item}<li>{@render inline(item)}</li>{/each}
        </ol>
      {:else}
        <ul class="md-list md-ul">
          {#each block.items as item}<li>{@render inline(item)}</li>{/each}
        </ul>
      {/if}
    {:else if block.type === 'blockquote'}
      <blockquote class="md-quote">
        {#each block.lines as line, idx}
          {#if idx > 0}<br />{/if}{@render inline(line)}
        {/each}
      </blockquote>
    {:else if block.type === 'code'}
      <!-- svelte-ignore a11y_no_noninteractive_tabindex (Scrollable code block needs keyboard access.) -->
      <div class="md-code-wrap" tabindex="0" role="region" aria-label={block.lang ? `${block.lang} 代码块，可横向滚动` : '代码块，可横向滚动'}>
        <pre><code>{block.code}</code></pre>
      </div>
    {:else if block.type === 'table'}
      <!-- svelte-ignore a11y_no_noninteractive_tabindex (Scrollable table needs keyboard access.) -->
      <div class="md-table-wrap" tabindex="0" role="region" aria-label="数据表格，可横向滚动">
        <table>
          <thead>
            <tr>
              {#each block.headers as header}
                <th scope="col">{@render inline(header)}</th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each block.rows as row}
              <tr>
                {#each row as cell}
                  <td>{@render inline(cell)}</td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else if block.type === 'hr'}
      <hr class="md-hr" />
    {/if}
  {/each}
</div>

<style>
  .assistant-md {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-3);
    min-width: 0;
    color: var(--foreground);
    font-size: var(--text-body);
    line-height: var(--line-height-body);
    overflow-wrap: anywhere;
  }
  .md-h1 {
    font-size: var(--text-card);
    font-weight: var(--weight-semibold);
    line-height: var(--line-height-heading);
    letter-spacing: 0;
  }
  .md-h2,
  .md-h3 {
    font-size: var(--text-body);
    font-weight: var(--weight-semibold);
    line-height: var(--line-height-heading);
    letter-spacing: 0;
  }
  .md-p {
    margin: 0;
  }
  .md-list {
    margin: 0;
    padding-left: var(--space-6);
    display: grid;
    gap: var(--space-1);
  }
  .md-ul {
    list-style: disc;
  }
  .md-ol {
    list-style: decimal;
  }
  .md-quote {
    margin: 0;
    padding: var(--space-2) var(--space-4);
    border-left: 3px solid var(--primary);
    border-radius: 0 var(--radius-control) var(--radius-control) 0;
    background: var(--muted);
    color: var(--muted-foreground);
    font-size: var(--text-small);
  }
  .md-inline-code {
    padding: 0.08rem 0.35rem;
    border: 1px solid var(--border);
    border-radius: 0.35rem;
    background: var(--muted);
    font-size: var(--text-small);
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
  }
  .md-code-wrap {
    max-width: 100%;
    overflow-x: auto;
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    background: var(--background);
    font-size: var(--text-small);
    line-height: var(--line-height-body);
  }
  .md-code-wrap pre {
    margin: 0;
    white-space: pre;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  }
  .md-table-wrap {
    max-width: 100%;
    overflow-x: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    background: var(--background);
  }
  .md-table-wrap table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-small);
    font-variant-numeric: tabular-nums;
    text-align: left;
  }
  .md-table-wrap th,
  .md-table-wrap td {
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--border);
    vertical-align: top;
  }
  .md-table-wrap tr:last-child td {
    border-bottom: 0;
  }
  .md-table-wrap thead th {
    background: var(--muted);
    color: var(--muted-foreground);
    font-weight: var(--weight-semibold);
    white-space: nowrap;
  }
  .md-hr {
    border: 0;
    border-top: 1px solid var(--border);
    margin: var(--space-1) 0;
  }
</style>
