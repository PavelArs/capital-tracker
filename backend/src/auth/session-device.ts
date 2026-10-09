// SEC-SESSIONS: a short name for the browser of a session, such as "Safari on iPhone".
// Only these fixed names are stored; the User-Agent header itself is never kept.
const browsers: [RegExp, string][] = [
  [/\bEdg(?:e|A|iOS)?\//, 'Edge'],
  [/\bYaBrowser\//, 'Yandex Browser'],
  [/\b(?:OPR|Opera)\//, 'Opera'],
  [/\b(?:Firefox|FxiOS)\//, 'Firefox'],
  [/(?:Chrome|CriOS|Chromium)\//, 'Chrome'],
  [/\bSafari\//, 'Safari'],
];
const systems: [RegExp, string][] = [
  [/\biPhone\b/, 'iPhone'],
  [/\biPad\b/, 'iPad'],
  [/\bAndroid\b/, 'Android'],
  [/\bWindows\b/, 'Windows'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bMac OS X\b|\bMacintosh\b/, 'macOS'],
  [/\bLinux\b/, 'Linux'],
];

export function deviceLabel(userAgent: unknown): string | null {
  if (typeof userAgent !== 'string') return null;
  const agent = userAgent.slice(0, 512);
  const browser = browsers.find(([pattern]) => pattern.test(agent))?.[1];
  const system = systems.find(([pattern]) => pattern.test(agent))?.[1];
  if (browser && system) return `${browser} on ${system}`;
  return browser ?? system ?? null;
}
