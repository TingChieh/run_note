/** @type {import('stylelint').Config} */
export default {
  overrides: [{ files: ['**/*.svelte'], customSyntax: 'postcss-html' }],
  rules: {
    'declaration-property-value-allowed-list': {
      'font-size': ['/^var\\(--text-[a-z-]+\\)$/'],
      'font-weight': ['/^var\\(--weight-[a-z-]+\\)$/', 'inherit', 'normal', 'bold'],
      'letter-spacing': ['0', '/^var\\(--tracking-[a-z-]+\\)$/', 'inherit', 'normal'],
      'line-height': ['/^var\\(--line-height-[a-z-]+\\)$/', 'inherit', 'normal'],
    },
  },
};
