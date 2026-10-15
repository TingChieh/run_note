import base from './playwright.ui.config';
export default { ...base, testMatch: ['mifitness.spec.ts'], use: {...base.use, baseURL:'http://127.0.0.1:5293'}, webServer: [
  {command:'node tests/fixtures/ui-api.mjs',url:'http://127.0.0.1:8293/api/health',env:{UI_API_PORT:'8293'},reuseExistingServer:false},
  {command:'node node_modules/vite/bin/vite.js dev --host 127.0.0.1 --port 5293',url:'http://127.0.0.1:5293/login',env:{INTERNAL_API_BASE_URL:'http://127.0.0.1:8293'},reuseExistingServer:false}
] };
