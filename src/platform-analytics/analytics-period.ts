import { bogotaDateKey, bogotaDayBounds } from '../common/bogota-time';

export type AnalyticsGranularity = 'day' | 'week' | 'month';

export function parseDateRange(dateFrom?: string, dateTo?: string): {
  from: Date;
  to: Date;
  fromKey: string;
  toKey: string;
} {
  const todayKey = bogotaDateKey(new Date());
  const [y, m] = todayKey.split('-').map(Number);
  const monthStart = `${y}-${String(m).padStart(2, '0')}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const monthEnd = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  let fromKey = monthStart;
  let toKey = monthEnd;

  if (dateFrom?.trim() && /^\d{4}-\d{2}-\d{2}$/.test(dateFrom.trim())) {
    fromKey = dateFrom.trim();
  }
  if (dateTo?.trim() && /^\d{4}-\d{2}-\d{2}$/.test(dateTo.trim())) {
    toKey = dateTo.trim();
  }

  if (fromKey > toKey) {
    const swap = fromKey;
    fromKey = toKey;
    toKey = swap;
  }

  return {
    from: bogotaDayBounds(fromKey).from,
    to: bogotaDayBounds(toKey).to,
    fromKey,
    toKey,
  };
}

/** Lunes de la semana en calendario Bogotá (YYYY-MM-DD). */
function bogotaWeekStartKey(date: Date): string {
  const key = bogotaDateKey(date);
  const [y, m, d] = key.split('-').map(Number);
  const noon = new Date(`${key}T12:00:00-05:00`);
  const dow = noon.getUTCDay();
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(Date.UTC(y, m - 1, d + mondayOffset));
  return monday.toISOString().slice(0, 10);
}

export function periodKey(date: Date, granularity: AnalyticsGranularity): string {
  const day = bogotaDateKey(date);
  if (granularity === 'month') {
    return day.slice(0, 7);
  }
  if (granularity === 'week') {
    return bogotaWeekStartKey(date);
  }
  return day;
}

export function periodLabel(key: string, granularity: AnalyticsGranularity): string {
  if (granularity === 'month') {
    const [y, m] = key.split('-');
    const dt = new Date(Number(y), Number(m) - 1, 1);
    return new Intl.DateTimeFormat('es-CO', {
      month: 'long',
      year: 'numeric',
    }).format(dt);
  }
  if (granularity === 'week') {
    const start = new Date(`${key}T12:00:00-05:00`);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 6);
    const fmt = new Intl.DateTimeFormat('es-CO', {
      day: 'numeric',
      month: 'short',
    });
    return `Sem. ${fmt.format(start)} – ${fmt.format(end)}`;
  }
  const dt = new Date(`${key}T12:00:00-05:00`);
  return new Intl.DateTimeFormat('es-CO', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(dt);
}

type Bucket = {
  count: number;
  totalCOP: number;
  profitCOP?: number;
  hours?: number;
  cashCOP?: number;
  nequiCOP?: number;
  otherCOP?: number;
};

export function mergeIntoBuckets(
  buckets: Map<string, Bucket>,
  key: string,
  patch: Partial<Bucket>,
): void {
  const prev = buckets.get(key) ?? { count: 0, totalCOP: 0 };
  buckets.set(key, {
    count: prev.count + (patch.count ?? 0),
    totalCOP: prev.totalCOP + (patch.totalCOP ?? 0),
    profitCOP: (prev.profitCOP ?? 0) + (patch.profitCOP ?? 0),
    hours: (prev.hours ?? 0) + (patch.hours ?? 0),
    cashCOP: (prev.cashCOP ?? 0) + (patch.cashCOP ?? 0),
    nequiCOP: (prev.nequiCOP ?? 0) + (patch.nequiCOP ?? 0),
    otherCOP: (prev.otherCOP ?? 0) + (patch.otherCOP ?? 0),
  });
}

export function bucketsToSeries(
  buckets: Map<string, Bucket>,
  granularity: AnalyticsGranularity,
) {
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, agg]) => ({
      period,
      label: periodLabel(period, granularity),
      count: agg.count,
      totalCOP: Math.round(agg.totalCOP),
      profitCOP:
        agg.profitCOP != null ? Math.round(agg.profitCOP) : undefined,
      hours:
        agg.hours != null
          ? Math.round(agg.hours * 100) / 100
          : undefined,
      cashCOP: agg.cashCOP != null ? Math.round(agg.cashCOP) : undefined,
      nequiCOP: agg.nequiCOP != null ? Math.round(agg.nequiCOP) : undefined,
      otherCOP: agg.otherCOP != null ? Math.round(agg.otherCOP) : undefined,
    }));
}

/** Incluye todos los días del rango (p. ej. lunes–domingo) aunque no haya movimientos. */
export function enumerateDayKeys(fromKey: string, toKey: string): string[] {
  const keys: string[] = [];
  let cursor = fromKey;
  while (cursor <= toKey) {
    keys.push(cursor);
    const [y, m, d] = cursor.split('-').map(Number);
    cursor = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
    if (keys.length > 400) break;
  }
  return keys;
}
