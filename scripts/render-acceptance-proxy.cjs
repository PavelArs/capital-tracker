'use strict';
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const root = resolve(__dirname, '..');

function renderAcceptanceProxy(mode = 'both') {
  if (!['primary', 'replica', 'both'].includes(mode)) throw new Error('Unknown synthetic upstream selection');
  const servers = mode === 'primary' ? ['backend:3000']
    : mode === 'replica' ? ['backend-replica:3000'] : ['backend:3000', 'backend-replica:3000'];
  // Routing and identity directives remain the actual deployment template's.
  // Only synthetic authorities/TLS and the selectable backend pool are substituted.
  const template = readFileSync(resolve(root, 'deploy/nginx.conf'), 'utf8')
    .replaceAll('<your-domain>', 'localhost')
    .replaceAll('/etc/letsencrypt/live/localhost', '/etc/nginx/tls')
    .replaceAll('http://127.0.0.1:3000', 'http://acceptance_backend')
    .replaceAll('http://127.0.0.1:3001', 'http://frontend:80');
  return `# Synthetic fixture: no automatic upstream replay, no credentials in routing evidence.
upstream acceptance_backend {
    zone acceptance_backend 64k;
${servers.map(server => `    server ${server};`).join('\n')}
}
proxy_next_upstream off;
log_format acceptance_upstream '$remote_addr $upstream_addr';
access_log /var/log/nginx/acceptance-upstreams.log acceptance_upstream;
${template}`;
}
module.exports = { renderAcceptanceProxy };
