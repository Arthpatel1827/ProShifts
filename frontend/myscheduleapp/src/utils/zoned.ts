// src/utils/zoned.ts
// Shift times in the *location's* timezone (from the API), whatever timezone the phone
// is in. Falls back to the phone's own time if the device lacks that timezone data.

const cache = new Map<string, Intl.DateTimeFormat>();

function formatter(tz?: string) {
    const key = tz ?? '';
    let f = cache.get(key);
    if (!f) {
        try {
            f = new Intl.DateTimeFormat('en-CA', {
                timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit', hour12: false,
            });
        } catch {
            f = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
        }
        cache.set(key, f);
    }
    return f;
}

export function zonedParts(value: string | Date, tz?: string) {
    const d = typeof value === 'string' ? new Date(value) : value;
    const p: Record<string, string> = {};
    for (const part of formatter(tz).formatToParts(d)) p[part.type] = part.value;
    const hour = p.hour === '24' ? 0 : Number(p.hour);
    return { key: `${p.year}-${p.month}-${p.day}`, minutes: hour * 60 + Number(p.minute) };
}

export const dateKeyIn = (v: string | Date, tz?: string) => zonedParts(v, tz).key;
export const minutesIn = (v: string | Date, tz?: string) => zonedParts(v, tz).minutes;
export const todayKeyIn = (tz?: string) => dateKeyIn(new Date(), tz);

const noon = (key: string) => {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d, 12));
};

export function addDaysKey(key: string, days: number) {
    const d = noon(key);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

export function mondayKey(key: string) {
    const dow = noon(key).getUTCDay();
    return addDaysKey(key, dow === 0 ? -6 : 1 - dow);
}

export const daysBetween = (a: string, b: string) => Math.round((noon(b).getTime() - noon(a).getTime()) / 86_400_000);

export function formatKey(key: string, opts: Intl.DateTimeFormatOptions) {
    return noon(key).toLocaleDateString('en-CA', { ...opts, timeZone: 'UTC' });
}

/** "9 AM", "9:30 PM" */
export function clockLabel(minutes: number) {
    const m = ((minutes % 1440) + 1440) % 1440;
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return `${((h + 11) % 12) + 1}${mm ? `:${String(mm).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
}

export function timeIn(value: string, tz?: string) {
    return clockLabel(minutesIn(value, tz));
}
