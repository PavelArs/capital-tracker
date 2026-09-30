const { readFileSync } = require('node:fs');
function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}
function validateInfrastructurePins(pins) {
  if (!exactKeys(pins, ['postgres', 'redis'])) throw new Error('Invalid infrastructure pins');
  const postgres = pins.postgres;
  if (!exactKeys(postgres, ['tag', 'dockerfile', 'dockerfileSha256', 'baseRegistryDigest'])
    || postgres.tag !== 'capital-tracker-postgres:acceptance'
    || postgres.dockerfile !== 'deploy/postgres.Dockerfile'
    || !/^[a-f0-9]{64}$/.test(postgres.dockerfileSha256)
    || postgres.baseRegistryDigest !== 'postgres@sha256:d8703cd7fba306b9fec9268ecedfa8a966846c053036a60e3635791957eb2f66') {
    throw new Error('Invalid derived PostgreSQL source pin');
  }
  const redis = pins.redis;
  if (!exactKeys(redis, ['tag', 'registryDigest']) || redis.tag !== 'redis:8.10.2-alpine3.23'
    || !/^redis@sha256:[a-f0-9]{64}$/.test(redis.registryDigest)) throw new Error('Invalid Redis pin');
  return pins;
}
function validateRelease(value, expectedCommit, expectedRunId, infrastructurePins) {
  if (!exactKeys(value, ['schemaVersion', 'commit', 'runId', 'backend', 'frontend', 'infrastructure'])
    || value.schemaVersion !== 3 || !/^[a-f0-9]{40}$/.test(value.commit)
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
    if (!exactKeys(image, ['imageId', ...Object.keys(pin)])
      || !/^sha256:[a-f0-9]{64}$/.test(image.imageId)
      || Object.entries(pin).some(([field, expected]) => image[field] !== expected)) {
      throw new Error('Invalid infrastructure image');
    }
  }
  return value;
}
function validateLoadedImages(manifest, inspect) {
  for (const image of [manifest.backend, manifest.frontend, ...Object.values(manifest.infrastructure)]) {
    const actual = inspect(image.tag);
    if (actual.Id !== image.imageId || actual.Os !== 'linux' || actual.Architecture !== 'amd64') {
      throw new Error('Candidate image identity or architecture mismatch');
    }
    if (image.tag === manifest.infrastructure.postgres.tag
      && actual.Config?.Labels?.['org.opencontainers.image.revision'] !== manifest.commit) {
      throw new Error('PostgreSQL build revision mismatch');
    }
  }
}
module.exports = { validateRelease, validateInfrastructurePins, validateLoadedImages };
if (require.main === module) {
  try { validateRelease(JSON.parse(readFileSync(process.argv[2], 'utf8')), process.argv[3], process.argv[4], JSON.parse(readFileSync(process.argv[5], 'utf8'))); }
  catch { console.error('Release manifest validation failed'); process.exitCode = 1; }
}
