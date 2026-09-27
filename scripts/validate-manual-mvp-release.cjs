const { readFileSync } = require('node:fs');
function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}
function validateRelease(value, expectedCommit, expectedRunId) {
  if (!exactKeys(value, ['schemaVersion', 'commit', 'runId', 'backend', 'frontend'])
    || value.schemaVersion !== 1 || !/^[a-f0-9]{40}$/.test(value.commit)
    || value.commit !== expectedCommit || typeof value.runId !== 'string' || !/^[1-9][0-9]*$/.test(value.runId)
    || value.runId !== String(expectedRunId)) throw new Error('Invalid release provenance');
  for (const name of ['backend', 'frontend']) {
    const image = value[name];
    if (!exactKeys(image, ['imageId', 'tag']) || !/^sha256:[a-f0-9]{64}$/.test(image.imageId)
      || image.tag !== `capital-tracker-${name}:acceptance`) throw new Error('Invalid release image');
  }
  return value;
}
module.exports = { validateRelease };
if (require.main === module) {
  try { validateRelease(JSON.parse(readFileSync(process.argv[2], 'utf8')), process.argv[3], process.argv[4]); }
  catch { console.error('Release manifest validation failed'); process.exitCode = 1; }
}
