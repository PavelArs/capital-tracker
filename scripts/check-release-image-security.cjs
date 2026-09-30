const { readFileSync, writeFileSync, existsSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const images = {
  backend: 'capital-tracker-backend:acceptance',
  frontend: 'capital-tracker-frontend:acceptance',
  postgres: 'postgres:18.6-alpine3.24',
  redis: 'redis:8.10.2-alpine3.23',
};
function checkReport(report, expectedImageId) {
  if (!report || report.SchemaVersion !== 2 || report.Metadata?.ImageID !== expectedImageId
    || !Array.isArray(report.Results) || !report.Results.some(result => result.Class === 'os-pkgs')) throw new Error('Image scanner report identity or structure invalid');
  const blocked = [];
  for (const result of report.Results) {
    for (const finding of [...(result.Vulnerabilities ?? []), ...(result.Secrets ?? [])]) {
      if (['HIGH', 'CRITICAL'].includes(finding.Severity)) blocked.push(finding.VulnerabilityID ?? finding.RuleID);
    }
  }
  if (blocked.length) throw new Error(`Image security gate blocked ${blocked.length} high/critical findings`);
}
function redactReport(report) {
  if (report.Metadata) delete report.Metadata.ImageConfig;
  for (const result of report.Results ?? []) {
    for (const finding of result.Secrets ?? []) {
      delete finding.Match;
      delete finding.Content;
      delete finding.Code;
    }
  }
  return report;
}
module.exports = { checkReport, redactReport };
if (require.main === module) {
  try {
    if (process.argv[2] === '--redact-only') {
      for (const name of Object.keys(images)) {
        const file = `${name}-image-security.json`;
        if (existsSync(file)) writeFileSync(file, JSON.stringify(redactReport(JSON.parse(readFileSync(file, 'utf8')))));
      }
      process.exit(0);
    }
    for (const [name, tag] of Object.entries(images)) {
      const expected = execFileSync('docker', ['image', 'inspect', tag, '--format', '{{.Id}}'], { encoding: 'utf8' }).trim();
      checkReport(JSON.parse(readFileSync(`${name}-image-security.json`, 'utf8')), expected);
    }
    console.log('Four exact tested images passed the high/critical vulnerability and secret gate; complete findings retained');
  } catch { console.error('Image security gate failed; inspect the sanitized report and scanner status'); process.exitCode = 1; }
}
