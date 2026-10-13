#!/usr/bin/env node
'use strict';

// Keeps the GitHub Actions cache of this repository small (owner request 2026-10-13).
// The cache is shared by every run and evicted least-recently-used above its size limit, so
// copies saved under closed pull requests and superseded keys push out the ones main needs.
//   report              prints what the cache holds, grouped by key family and kind of ref
//   delete-ref <ref>    deletes every cache saved under one ref (a closed pull request)
//   sweep               lists what the rules below would delete; --apply deletes it
// Rules of the sweep, in this order (a cache is listed once, under the first rule):
//   closed-ref   saved under a pull request merge ref or a branch that has no open pull request
//   superseded   an older copy of the same key family under the same ref (a new lockfile or
//                browser version made it obsolete)
//   stale        not used for MAX_AGE_DAYS days (default 5)
// Caches of main are never removed by the first rule, and only the newest copy of a family
// survives under any ref.
const MAIN_REF = 'refs/heads/main';

function kindOf(ref) {
  if (ref === MAIN_REF) return 'main';
  if (/^refs\/pull\/[0-9]+\/merge$/.test(ref)) return 'pull';
  return 'branch';
}

// Cache keys end in a lockfile hash or a version; the family is what stays the same.
function familyOf(key) {
  return String(key)
    .replace(/[a-f0-9]{16,}/g, '<hash>')
    .replace(/[0-9]+\.[0-9]+\.[0-9]+[^-]*/g, '<version>');
}

function summarize(caches) {
  const groups = new Map();
  let bytes = 0;
  for (const cache of caches) {
    bytes += cache.size_in_bytes;
    const name = `${kindOf(cache.ref)} ${familyOf(cache.key)}`;
    const group = groups.get(name) ?? { name, count: 0, bytes: 0, oldestAccess: cache.last_accessed_at };
    group.count += 1;
    group.bytes += cache.size_in_bytes;
    if (cache.last_accessed_at < group.oldestAccess) group.oldestAccess = cache.last_accessed_at;
    groups.set(name, group);
  }
  return {
    count: caches.length,
    bytes,
    groups: [...groups.values()].sort((a, b) => b.bytes - a.bytes),
  };
}

// openRefs: refs of open pull requests, as `refs/pull/N/merge` and `refs/heads/<branch>`.
function selectForSweep(caches, { now, maxAgeDays, openRefs }) {
  const chosen = new Map();
  const choose = (cache, rule) => {
    if (!chosen.has(cache.id)) chosen.set(cache.id, { cache, rule });
  };
  for (const cache of caches) {
    if (cache.ref !== MAIN_REF && !openRefs.has(cache.ref)) choose(cache, 'closed-ref');
  }
  const newest = new Map();
  for (const cache of caches) {
    const slot = `${cache.ref}\0${familyOf(cache.key)}`;
    const best = newest.get(slot);
    if (!best || cache.created_at > best.created_at) newest.set(slot, cache);
  }
  for (const cache of caches) {
    if (newest.get(`${cache.ref}\0${familyOf(cache.key)}`) !== cache) choose(cache, 'superseded');
  }
  const limit = now - maxAgeDays * 86_400_000;
  for (const cache of caches) {
    if (Date.parse(cache.last_accessed_at) < limit) choose(cache, 'stale');
  }
  const byRule = {};
  let bytes = 0;
  for (const { cache, rule } of chosen.values()) {
    byRule[rule] ??= { count: 0, bytes: 0 };
    byRule[rule].count += 1;
    byRule[rule].bytes += cache.size_in_bytes;
    bytes += cache.size_in_bytes;
  }
  return { selected: [...chosen.values()].map(({ cache }) => cache), byRule, count: chosen.size, bytes };
}

function githubClient(token, api = 'https://api.github.com') {
  return async (method, path) => {
    const response = await fetch(`${api}/${path}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
      },
    });
    if (!response.ok) throw new Error(`GitHub API ${method} request failed with ${response.status}`);
    return response.status === 204 ? undefined : response.json();
  };
}

async function listCaches(call, repository) {
  const caches = [];
  for (let page = 1; ; page++) {
    const body = await call('GET', `repos/${repository}/actions/caches?per_page=100&page=${page}`);
    caches.push(...(body.actions_caches ?? []));
    if ((body.actions_caches ?? []).length < 100) return caches;
  }
}

async function openRefsOf(call, repository) {
  const refs = new Set();
  for (let page = 1; ; page++) {
    const pulls = await call('GET', `repos/${repository}/pulls?state=open&per_page=100&page=${page}`);
    for (const pull of pulls) {
      refs.add(`refs/pull/${pull.number}/merge`);
      if (pull.head?.repo?.full_name === repository) refs.add(`refs/heads/${pull.head.ref}`);
    }
    if (pulls.length < 100) return refs;
  }
}

const mib = (bytes) => `${(bytes / 1048576).toFixed(1)} MiB`;

function formatSummary(summary) {
  const lines = [`${summary.count} caches, ${mib(summary.bytes)}`];
  for (const group of summary.groups) {
    lines.push(`${group.count} x ${group.name}: ${mib(group.bytes)}, oldest use ${group.oldestAccess}`);
  }
  return lines.join('\n');
}

async function deleteCaches(call, repository, caches) {
  for (const cache of caches) await call('DELETE', `repos/${repository}/actions/caches/${cache.id}`);
}

module.exports = { kindOf, familyOf, summarize, selectForSweep, listCaches, openRefsOf, formatSummary, deleteCaches };

if (require.main === module) {
  const { GITHUB_REPOSITORY: repository, GH_TOKEN, GITHUB_API_URL, GITHUB_STEP_SUMMARY, MAX_AGE_DAYS } = process.env;
  const [command, ...args] = process.argv.slice(2);
  const out = (text) => {
    console.log(text);
    if (GITHUB_STEP_SUMMARY) require('node:fs').appendFileSync(GITHUB_STEP_SUMMARY, `${text}\n`);
  };
  (async () => {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '')) throw new Error('Expected GITHUB_REPOSITORY');
    const call = githubClient(GH_TOKEN, GITHUB_API_URL);
    const caches = await listCaches(call, repository);
    if (command === 'report' && args.length === 0) {
      out(formatSummary(summarize(caches)));
    } else if (command === 'delete-ref' && args.length === 1 && /^refs\/(pull\/[0-9]+\/merge|heads\/.+)$/.test(args[0]) && args[0] !== MAIN_REF) {
      const own = caches.filter((cache) => cache.ref === args[0]);
      await deleteCaches(call, repository, own);
      out(`Deleted ${own.length} caches of ${args[0]} (${mib(own.reduce((sum, cache) => sum + cache.size_in_bytes, 0))})`);
    } else if (command === 'sweep' && args.every((arg) => arg === '--apply')) {
      const maxAgeDays = Number(MAX_AGE_DAYS ?? '5');
      if (!(maxAgeDays >= 1)) throw new Error('MAX_AGE_DAYS must be at least 1');
      const plan = selectForSweep(caches, { now: Date.now(), maxAgeDays, openRefs: await openRefsOf(call, repository) });
      const apply = args.includes('--apply');
      const rules = Object.entries(plan.byRule).map(([rule, value]) => `${rule}: ${value.count} (${mib(value.bytes)})`);
      out(`${apply ? 'Deleting' : 'Would delete'} ${plan.count} of ${caches.length} caches, ${mib(plan.bytes)}${rules.length ? ` [${rules.join('; ')}]` : ''}`);
      if (apply) await deleteCaches(call, repository, plan.selected);
    } else {
      throw new Error('Use actions-caches.cjs report | delete-ref <ref> | sweep [--apply]');
    }
  })().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Cache hygiene failed');
    process.exitCode = 1;
  });
}
