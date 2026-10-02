const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | null | undefined): value is string {
  return !!value && UUID_RE.test(value);
}

const E164_RE = /^\+[1-9]\d{6,14}$/;

export function isE164(value: string): boolean {
  return E164_RE.test(value);
}
