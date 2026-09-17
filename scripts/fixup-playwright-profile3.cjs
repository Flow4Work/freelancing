const fs = require('node:fs');
const path = require('node:path');

const profile = process.env.FIXUP_PLAYWRIGHT_MCP_PROFILE;
const userDataDir = process.env.FIXUP_PLAYWRIGHT_MCP_USER_DATA_DIR;
const target = userDataDir
  ? path.resolve(userDataDir, 'Local State').toLowerCase()
  : null;
const originalReadFile = fs.promises.readFile.bind(fs.promises);

fs.promises.readFile = async function fixupReadFile(file, ...args) {
  if (!profile || !target || path.resolve(String(file)).toLowerCase() !== target)
    return originalReadFile(file, ...args);

  const encoding = args[0];
  const patched = JSON.stringify({ profile: { last_used: profile } });
  return typeof encoding === 'string' || (encoding && typeof encoding === 'object' && encoding.encoding)
    ? patched
    : Buffer.from(patched, 'utf8');
};
