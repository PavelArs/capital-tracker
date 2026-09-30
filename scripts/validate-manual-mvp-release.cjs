const { readFileSync } = require('node:fs');
function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}
function validateInfrastructurePins(pins) {
  if (!exactKeys(pins, ['postgres', 'redis'])) throw new Error('Invalid infrastructure pins');
  for (const [name, tag] of [['postgres', 'postgres:18.6-alpine3.24'], ['redis', 'redis:8.10.2-alpine3.23']]) {
    const pin = pins[name];
    if (!exactKeys(pin, ['tag', 'registryDigest']) || pin.tag !== tag
      || !new RegExp(`^${name}@sha256:[a-f0-9]{64}$`).test(pin.registryDigest)) {
      throw new Error('Invalid infrastructure pin');
    }
  }
  return pins;
}
function validateRelease(value, expectedCommit, expectedRunId, infrastructurePins) {
  if (!exactKeys(value, ['schemaVersion', 'commit', 'runId', 'backend', 'frontend', 'infrastructure'])
    || value.schemaVersion !== 2 || !/^[a-f0-9]{40}$/.test(value.commit)
    || value.commit !== expectedCommit || typeof value.runId !== 'string' || !/^[1-9][0-9]*$/.test(value.runId)
    || value.runId !== String(expectedRunId)) throw new Error('Invalid release provenance');
  for (const name of ['backend', 'frontend']) {
    const image = value[name];
    if (!exactKeys(image, ['imageId', 'tag']) || !/^sha256:[a-f0-9]{64}$/.test(image.imageId)
      || image.tag !== `capital-tracker-${name}:acceptance`) throw new Error('Invalid release image');
  }
  validateInfrastructurePins(infrastructurePins);
  if (!exactKeys(value.infrastructure, ['postgres', 'redis'])) throw new Error('Invalid infrastructure images');
  for (const name of ['postgres', 'redis']) {
    const pin = infrastructurePins[name];
    const image = value.infrastructure[name];
    if (!exactKeys(image, ['imageId', 'tag', 'registryDigest'])
      || !/^sha256:[a-f0-9]{64}$/.test(image.imageId)
      || image.tag !== pin.tag || image.registryDigest !== pin.registryDigest) {
      throw new Error('Invalid infrastructure image');
    }
  }
  return value;
}
module.exports = { validateRelease, validateInfrastructurePins };
if (require.main === module) {
  try { validateRelease(JSON.parse(readFileSync(process.argv[2], 'utf8')), process.argv[3], process.argv[4], JSON.parse(readFileSync(process.argv[5], 'utf8'))); }
  catch { console.error('Release manifest validation failed'); process.exitCode = 1; }
}
