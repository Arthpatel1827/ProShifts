// Date/time helpers. Keep every conversion in this file.
//
// Scheduling is in the *location's* timezone (Location.timezone), not the browser's:
// a manager in Toronto looking at a Vancouver location sees Vancouver days and times.
//  • Shift start/end come back as instants with an offset. Display them with a `tz`.
//  • Calendar dates are "YYYY-MM-DD" keys; do arithmetic on keys, never on local Dates.
//  • To create or edit a shift, send naive wall-clock time at the location
//    (naiveLocalIso); the API attaches the location's timezone.
//  • Record timestamps (created_at, updated_at) are naive UTC: parse with fromServerUtc.
//    Messaging shows those in the reader's own browser time.

const LOCALE = "en-CA";

// ── Location-timezone helpers ───────────────────────────────────────────────

/** A valid IANA zone for Intl, falling back to UTC. */
export function safeTz(tz: string | null | undefined): string {
    if (!tz) return "UTC";
    try {
        new Intl.DateTimeFormat(LOCALE, { timeZone: tz });
        return tz;
    } catch {
        return "UTC";
    }
}

const partsCache = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(tz: string): Intl.DateTimeFormat {
    let f = partsCache.get(tz);
    if (!f) {
        f = new Intl.DateTimeFormat("en-US", {
            timeZone: tz,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
        });
        partsCache.set(tz, f);
    }
    return f;
}

function zonedParts(value: string | Date, tz: string) {
    const d = typeof value === "string" ? new Date(value) : value;
    const p = Object.fromEntries(partsFormatter(safeTz(tz)).formatToParts(d).map((x) => [x.type, x.value]));
    return { y: p.year, m: p.month, d: p.day, hh: p.hour === "24" ? "00" : p.hour, mm: p.minute };
}

/** "YYYY-MM-DD" calendar date of an instant at the location. */
export function dateKeyIn(value: string | Date, tz: string): string {
    const p = zonedParts(value, tz);
    return `${p.y}-${p.m}-${p.d}`;
}

/** Today's date key at the location. */
export function todayKey(tz: string): string {
    return dateKeyIn(new Date(), tz);
}

/** "HH:MM" (24h) wall-clock time of an instant at the location, for <input type="time">. */
export function timeIn(value: string | Date, tz: string): string {
    const p = zonedParts(value, tz);
    return `${p.hh}:${p.mm}`;
}

function keyToUtcNoon(key: string): Date {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d, 12));
}

export function addDaysToKey(key: string, days: number): string {
    const d = keyToUtcNoon(key);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

/** Monday of the week containing `key`. */
export function mondayOfKey(key: string): string {
    const dow = keyToUtcNoon(key).getUTCDay(); // 0 = Sunday
    return addDaysToKey(key, dow === 0 ? -6 : 1 - dow);
}

/** Formats a date key ("2026-10-25") without any timezone shifting. */
export function formatKey(key: string, opts: Intl.DateTimeFormatOptions = {}): string {
    return keyToUtcNoon(key).toLocaleDateString(LOCALE, {
        weekday: "short",
        month: "short",
        day: "numeric",
        ...opts,
        timeZone: "UTC",
    });
}

/** Naive wall-clock time at the location — the API attaches the location's timezone. */
export function naiveLocalIso(dateKey: string, hhmm: string): string {
    return `${dateKey}T${hhmm}:00`;
}

export function isSameDay(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Time of an instant. Pass the location's tz for shifts; omit it for the viewer's own time. */
export function formatTime(iso: string | Date, tz?: string): string {
    const d = typeof iso === "string" ? new Date(iso) : iso;
    return d.toLocaleTimeString(LOCALE, {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
        ...(tz ? { timeZone: safeTz(tz) } : {}),
    });
}

export function formatTimeRange(startIso: string, endIso: string, tz?: string): string {
    return `${formatTime(startIso, tz)} – ${formatTime(endIso, tz)}`;
}

/** Date of an instant (in `tz`, or the viewer's time) or of a "YYYY-MM-DD" key. */
export function formatDate(value: string | Date, opts: Intl.DateTimeFormatOptions = {}, tz?: string): string {
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return formatKey(value, opts);
    const d = typeof value === "string" ? new Date(value) : value;
    return d.toLocaleDateString(LOCALE, {
        weekday: "short",
        month: "short",
        day: "numeric",
        ...opts,
        ...(tz ? { timeZone: safeTz(tz) } : {}),
    });
}

/** Parses a server record timestamp (naive UTC from datetime.utcnow()). */
export function fromServerUtc(iso: string): Date {
    return /(?:Z|[+-]\d{2}:?\d{2})$/.test(iso) ? new Date(iso) : new Date(`${iso}Z`);
}

/** "5m ago" for a server record timestamp (created_at etc.). */
export function formatRelative(iso: string): string {
    const diff = Date.now() - fromServerUtc(iso).getTime();
    const mins = Math.round(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    if (days < 7) return `${days}d ago`;
    return formatDate(fromServerUtc(iso));
}

/** Paid hours for a shift: duration minus unpaid break. */
export function shiftHours(startIso: string, endIso: string, breakMinutes = 0): number {
    const mins = (new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000 - breakMinutes;
    return Math.max(mins, 0) / 60;
}

export function formatHours(h: number): string {
    return `${Number.isInteger(h) ? h : h.toFixed(1)}h`;
}

const currency = new Intl.NumberFormat(LOCALE, { style: "currency", currency: "CAD", maximumFractionDigits: 0 });
export function formatMoney(n: number): string {
    return currency.format(n);
}

export function titleCase(s: string): string {
    return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
