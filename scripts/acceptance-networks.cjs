'use strict';
const { execFileSync } = require('node:child_process');
const subnets = ['172.30.90.0/24', '172.30.91.0/24'];
function interval(cidr) {
  const [address, prefixText] = cidr.split('/');
  const prefix = Number(prefixText);
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some(n => !Number.isInteger(n) || n < 0 || n > 255)
    || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) throw new Error('Invalid Docker IPv4 subnet metadata');
  const size = 2 ** (32 - prefix);
  const start = Math.floor(octets.reduce((n, part) => n * 256 + part, 0) / size) * size;
  return [start, start + size - 1];
}
function assertSyntheticNetworks() {
  const ids = execFileSync('docker', ['network', 'ls', '--format', '{{.ID}}'], { encoding: 'utf8', timeout: 30000 }).trim().split(/\s+/).filter(Boolean);
  if (!ids.length) return;
  const networks = JSON.parse(execFileSync('docker', ['network', 'inspect', ...ids], { encoding: 'utf8', timeout: 30000 }));
  for (const network of networks) {
    if (network.Labels?.['com.docker.compose.project'] === 'capital-tracker-e2e') continue;
    for (const config of network.IPAM?.Config ?? []) {
      if (!config.Subnet || config.Subnet.includes(':')) continue;
      const [start, end] = interval(config.Subnet);
      if (subnets.some(cidr => { const [a, b] = interval(cidr); return start <= b && a <= end; })) {
        throw new Error('Synthetic acceptance subnet overlaps an unrelated Docker network; no network was modified');
      }
    }
  }
}
module.exports = { assertSyntheticNetworks };
