'use strict';
const { createHash } = require('node:crypto');
const { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } = require('node:fs');

function snapshot(filePath) {
  if (!lstatSync(filePath).isFile()) {
    throw new Error(`Preservation requires a regular file: ${filePath}`);
  }
  // Do not follow a replacement symlink or block on a replacement special file.
  const descriptor = openSync(filePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile()) throw new Error(`Preservation requires a regular file: ${filePath}`);
    return {
      hash: createHash('sha256').update(readFileSync(descriptor)).digest('hex'),
      permissions: stat.mode & 0o7777,
    };
  } finally {
    closeSync(descriptor);
  }
}

async function withPreservedFile(filePath, action) {
  const before = snapshot(filePath);
  let actionFailed = false;
  let actionError;
  try {
    return await action();
  } catch (error) {
    actionFailed = true;
    actionError = error;
    throw error;
  } finally {
    try {
      const after = snapshot(filePath);
      if (after.hash !== before.hash || after.permissions !== before.permissions) {
        throw new Error(`Configuration preservation failed; file contents or permissions changed: ${filePath}`);
      }
    } catch (preservationError) {
      if (actionFailed) {
        throw new AggregateError(
          [actionError, preservationError],
          `Acceptance failed and configuration preservation failed: ${filePath}`,
        );
      }
      throw preservationError;
    }
  }
}

module.exports = { withPreservedFile };
