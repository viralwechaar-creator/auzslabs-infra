// Keys must never live in the brain folder or in a saved note. These patterns catch the common shapes.
const PATTERNS = [
  /sk-ant-[A-Za-z0-9_-]{10,}/g,
  /\bsk-[A-Za-z0-9]{20,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\bghp_[A-Za-z0-9]{30,}/g,
  /\brzp_(?:live|test)_[A-Za-z0-9]{8,}/g,
  /\b(?:api[_-]?key|secret|password|passwd|token)\b\s*[:=]\s*["']?[^\s"']{8,}/gi,
];

export function containsSecret(text) {
  const s = String(text || '');
  return PATTERNS.some((re) => { re.lastIndex = 0; return re.test(s); });
}

export function redactSecrets(text) {
  let s = String(text || '');
  for (const re of PATTERNS) { re.lastIndex = 0; s = s.replace(re, '[REDACTED]'); }
  return s;
}
