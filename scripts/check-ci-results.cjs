#!/usr/bin/env node
'use strict';

// Do not derive expected jobs from needs: an omitted dependency must fail closed.
const [input, ...required] = process.argv.slice(2);
try {
  if (!input || required.length === 0 ||
      required.some((job) => !/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(job)) ||
      new Set(required).size !== required.length) {
    throw new Error('Expected needs JSON and a nonempty, unique list of required jobs');
  }
  const needs = JSON.parse(input);
  if (needs === null || typeof needs !== 'object' || Array.isArray(needs)) {
    throw new Error('Needs must be an object');
  }
  const failed = required.filter((job) => {
    if (!Object.hasOwn(needs, job)) return true;
    const entry = needs[job];
    return entry === null || typeof entry !== 'object' || Array.isArray(entry) ||
      entry.result !== 'success';
  });
  if (failed.length) throw new Error(`Required jobs did not succeed: ${failed.join(', ')}`);
  console.log(`All ${required.length} required CI jobs succeeded`);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Invalid CI results');
  process.exitCode = 1;
}
