export function formatBaht(amount: number | string | null | undefined): string {
  const num = Number(amount ?? 0);
  return new Intl.NumberFormat('th-TH', {
    minimumFractionDigits: num % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(num) + ' ฿';
}

export function formatNumber(val: number | string | null | undefined): string {
  const num = Number(val ?? 0);
  return new Intl.NumberFormat('th-TH', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(num);
}

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}

export function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('th-TH', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

export function parseIsoDateUtcMs(iso: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utcMs = Date.UTC(year, month - 1, day);
  const probe = new Date(utcMs);
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return utcMs;
}

export function parseExpiryDatesMap(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const clean: Record<string, string> = {};
    for (const [productId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (parseIsoDateUtcMs(trimmed) !== null) {
          clean[productId] = trimmed;
        }
      }
    }
    return clean;
  } catch {
    return {};
  }
}

export function formatExpiryDateTh(iso: string): string {
  const utcMs = parseIsoDateUtcMs(iso);
  if (utcMs === null) return iso;
  return new Intl.DateTimeFormat('th-TH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(utcMs));
}
