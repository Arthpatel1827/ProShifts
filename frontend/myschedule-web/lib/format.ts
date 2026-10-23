// Date/time helpers. Keep every conversion in this file.
//
// Two kinds of naive (offset-less) timestamps come from the backend:
//  • Shift start/end are timestamptz and come back with an offset; send them with one too
//    (toOffsetIso), otherwise PostgreSQL reads them in the *database server's* timezone.
//  • Record timestamps (created_at, updated_at, assigned_at) come from datetime.utcnow()
//    → they are UTC and must be parsed with fromServerUtc, or they display hours off.

const LOCALE = "en-CA";

export function toDateKey(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

export function getMonday(date: Date): Date {
    const d = new Date(date);
    const day = d.getDay();
    d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
    d.setHours(0, 0, 0, 0);
    return d;
}

export function addDays(date: Date, days: number): Date {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
}

export function isSameDay(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "HH:MM" from a Date, for <input type="time">. */
export function toTimeInput(d: Date): string {
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** "YYYY-MM-DDTHH:MM:00-04:00" in the browser's timezone — accepted by datetime.fromisoformat. */
export function toOffsetIso(d: Date): string {
    const offset = -d.getTimezoneOffset();
    const sign = offset >= 0 ? "+" : "-";
    const abs = Math.abs(offset);
    const hh = String(Math.floor(abs / 60)).padStart(2, "0");
    const mm = String(abs % 60).padStart(2, "0");
    return `${toDateKey(d)}T${toTimeInput(d)}:00${sign}${hh}:${mm}`;
}

/** Combine a date key and "HH:MM" into a local Date. */
export function combine(dateKey: string, time: string): Date {
    const [y, m, d] = dateKey.split("-").map(Number);
    const [hh, mm] = time.split(":").map(Number);
    return new Date(y, m - 1, d, hh, mm, 0, 0);
}

export function formatTime(iso: string | Date): string {
    const d = typeof iso === "string" ? new Date(iso) : iso;
    return d.toLocaleTimeString(LOCALE, { hour: "numeric", minute: "2-digit", hour12: true });
}

export function formatTimeRange(startIso: string, endIso: string): string {
    return `${formatTime(startIso)} – ${formatTime(endIso)}`;
}

export function formatDate(iso: string | Date, opts: Intl.DateTimeFormatOptions = {}): string {
    const d = typeof iso === "string" ? parseDateish(iso) : iso;
    return d.toLocaleDateString(LOCALE, { weekday: "short", month: "short", day: "numeric", ...opts });
}

/** Parses "YYYY-MM-DD" as a local date (not UTC midnight). */
export function parseDateish(s: string): Date {
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? combine(s, "00:00") : new Date(s);
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
