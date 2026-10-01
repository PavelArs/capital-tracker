#!/usr/bin/env node
'use strict';

const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const PROFILE = 'critical';
const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const key = ({ file, title }) => `${file}\0${title}`;
const validCase = (item) => item && typeof item === 'object' && !Array.isArray(item)
  && Object.keys(item).sort().join(',') === 'file,title'
  && /^tests\/e2e\/[a-z0-9-]+\.spec\.ts$/.test(item.file)
  && typeof item.title === 'string' && item.title.trim() === item.title && item.title.length > 0;

function flatten(suites) {
  if (!Array.isArray(suites)) throw new Error('Missing Playwright suites');
  const found = [];
  for (const suite of suites) {
    if (!suite || typeof suite !== 'object') throw new Error('Invalid Playwright suite');
    for (const spec of suite.specs ?? []) {
      found.push({ file: `tests/e2e/${spec.file ?? suite.file}`, title: spec.title, tests: spec.tests });
    }
    found.push(...flatten(suite.suites ?? []));
  }
  return found;
}

function select(manifest, listing) {
  if (!Array.isArray(manifest) || manifest.length === 0 || manifest.some((item) => !validCase(item))) {
    throw new Error('Invalid or empty critical manifest');
  }
  if (new Set(manifest.map(key)).size !== manifest.length || new Set(manifest.map((item) => item.title)).size !== manifest.length) {
    throw new Error('Duplicate critical selection');
  }
  if (listing?.errors?.length) throw new Error('Playwright discovery errors');
  const inventory = flatten(listing?.suites);
  const matches = manifest.map((item) => {
    const exact = inventory.filter((candidate) => key(candidate) === key(item));
    if (exact.length !== 1 || exact[0].tests?.length !== 1) throw new Error(`Missing or ambiguous critical case: ${item.file} ${item.title}`);
    if (inventory.filter((candidate) => candidate.title === item.title).length !== 1) {
      throw new Error(`Ambiguous critical title: ${item.title}`);
    }
    return exact[0];
  });
  const files = [...new Set(manifest.map((item) => item.file.replace(/^tests\/e2e\//, '')))];
  const escaped = manifest.map((item) => item.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const grep = `(?:^|\\s)(?:${escaped.join('|')})$`;
  const routed = inventory.filter((item) => files.includes(item.file.replace(/^tests\/e2e\//, '')) && new RegExp(grep).test(item.title));
  if (routed.length !== manifest.length || new Set(routed.map(key)).size !== manifest.length) {
    throw new Error('Critical title expression selects extra or missing cases');
  }
  return { cases: manifest, matches, files, grep, manifestSha256: sha(manifest) };
}

function assertRouted(selection, listing) {
  if (listing?.errors?.length) throw new Error('Playwright routed discovery errors');
  const routed = flatten(listing?.suites);
  if (routed.length !== selection.cases.length || new Set(routed.map(key)).size !== routed.length
    || routed.some((item) => !selection.cases.some((required) => key(required) === key(item)))) {
    throw new Error('Playwright CLI selected missing, duplicate or extra critical cases');
  }
  return routed;
}

function receipt(selection, result, commit, runId) {
  if (!/^[a-f0-9]{40}$/.test(commit) || !/^(local|[1-9][0-9]*)$/.test(String(runId))) {
    throw new Error('Invalid acceptance identity');
  }
  if (result?.errors?.length) throw new Error('Playwright execution errors');
  const executed = flatten(result?.suites);
  if (executed.length !== selection.cases.length || new Set(executed.map(key)).size !== executed.length) {
    throw new Error('Partial or extra critical execution');
  }
  for (const item of selection.cases) {
    const actual = executed.find((candidate) => key(candidate) === key(item));
    const test = actual?.tests?.[0];
    if (!actual || actual.tests?.length !== 1 || test.expectedStatus !== 'passed'
      || test.status !== 'expected' || test.results?.length !== 1 || test.results[0].status !== 'passed') {
      throw new Error(`Critical case did not pass: ${item.file} ${item.title}`);
    }
  }
  return { schemaVersion: 1, profile: PROFILE, commit, runId: String(runId),
    manifestSha256: selection.manifestSha256,
    cases: selection.cases.map(({ file, title }) => ({ file, title, status: 'passed' })) };
}

function verify(value, manifest, commit, runId) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'cases,commit,manifestSha256,profile,runId,schemaVersion'
    || value.schemaVersion !== 1 || value.profile !== PROFILE || value.commit !== commit
    || !/^[a-f0-9]{40}$/.test(commit) || value.runId !== String(runId)
    || !/^[1-9][0-9]*$/.test(String(runId)) || value.manifestSha256 !== sha(manifest)
    || !Array.isArray(value.cases) || value.cases.length !== manifest.length
    || manifest.length === 0) throw new Error('Invalid critical acceptance receipt');
  for (let i = 0; i < manifest.length; i++) {
    const item = value.cases[i];
    if (!validCase(manifest[i]) || !item || Object.keys(item).sort().join(',') !== 'file,status,title'
      || item.file !== manifest[i].file || item.title !== manifest[i].title || item.status !== 'passed') {
      throw new Error('Incomplete critical acceptance receipt');
    }
  }
  if (new Set(manifest.map(key)).size !== manifest.length || new Set(manifest.map((item) => item.title)).size !== manifest.length) {
    throw new Error('Duplicate critical acceptance receipt');
  }
  return value;
}

module.exports = { select, assertRouted, receipt, verify };
if (require.main === module) {
  try {
    const [, , command, path, commit, runId] = process.argv;
    if (command !== 'verify' || !path) throw new Error('Use critical-release-profile.cjs verify <receipt> <commit> <runId>');
    const manifest = JSON.parse(readFileSync(resolve(__dirname, '../tests/e2e/manual-mvp-manifest.json'), 'utf8'));
    verify(JSON.parse(readFileSync(path, 'utf8')), manifest, commit, runId);
    console.log('Exact critical release acceptance receipt verified');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
