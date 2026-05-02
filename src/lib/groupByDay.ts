import { format, isToday, isYesterday } from 'date-fns';

type WithTimestamp = { timestamp: string };

export type DayGroup<T> = {
  /** yyyy-MM-dd */
  key: string;
  label: string;
  items: T[];
};

function toDateSafe(value: string): Date | null {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function groupByDay<T extends WithTimestamp>(items: T[]): DayGroup<T>[] {
  return groupByDayBy(items, (i) => i.timestamp);
}

export function groupByDayBy<T>(items: T[], getTimestamp: (item: T) => string): DayGroup<T>[] {
  const groups = new Map<string, { date: Date; items: T[] }>();
  const invalidItems: T[] = [];

  for (const item of items) {
    const d = toDateSafe(getTimestamp(item));
    if (!d) {
      invalidItems.push(item);
      continue;
    }

    const key = format(d, 'yyyy-MM-dd');
    const existing = groups.get(key);
    if (existing) {
      existing.items.push(item);
    } else {
      groups.set(key, { date: d, items: [item] });
    }
  }

  const sorted = Array.from(groups.entries()).sort(
    (a, b) => b[1].date.getTime() - a[1].date.getTime(),
  );
  const result: DayGroup<T>[] = sorted.map(([key, value]) => {
    const d = value.date;
    const label = isToday(d) ? 'Hoje' : isYesterday(d) ? 'Ontem' : format(d, 'dd/MM/yyyy');
    return { key, label, items: value.items };
  });

  if (invalidItems.length) {
    result.push({ key: 'invalid', label: 'Sem data', items: invalidItems });
  }

  return result;
}

