// src/utils/timelineSegments.ts
// How shifts are drawn on the week timeline. A shift that runs past midnight is ONE shift
// drawn as two parts: evening on its start day, early hours on the next day. A shift that
// started the night before the week (Sunday 10 PM → Monday 6 AM) shows its Monday part.
import { addDaysKey, dateKeyIn, daysBetween, minutesIn } from './zoned';

export type SegmentShift = {
    shift_id: number;
    start_time: string;
    end_time: string;
    status: string;
};

export type Segment<S extends SegmentShift = SegmentShift> = {
    shift: S;
    day: string;        // "YYYY-MM-DD" at the location
    from: number;       // minutes since that day's local midnight
    to: number;
    continues: boolean; // runs past midnight into the next row
    continued: boolean; // the after-midnight part of the previous day's shift
};

/** Parts of each shift that fall on the given days (all days if omitted). */
export function splitShifts<S extends SegmentShift>(shifts: S[], tz?: string, days?: string[]): Segment<S>[] {
    const out: Segment<S>[] = [];
    const seen = new Set<number>();
    for (const s of shifts) {
        if (s.status === 'cancelled' || seen.has(s.shift_id)) continue;
        seen.add(s.shift_id);
        const startDay = dateKeyIn(s.start_time, tz);
        const from = minutesIn(s.start_time, tz);
        const to = minutesIn(s.end_time, tz) + daysBetween(startDay, dateKeyIn(s.end_time, tz)) * 1440;
        out.push({ shift: s, day: startDay, from, to: Math.min(to, 1440), continues: to > 1440, continued: false });
        if (to > 1440) {
            out.push({ shift: s, day: addDaysKey(startDay, 1), from: 0, to: Math.min(to - 1440, 1440), continues: false, continued: true });
        }
    }
    return days ? out.filter(g => days.includes(g.day)) : out;
}

/** Local days of the week with any working time (an overnight shift counts on both days). */
export function workingDays(shifts: SegmentShift[], tz: string | undefined, days: string[]): Set<string> {
    return new Set(splitShifts(shifts, tz, days).map(g => g.day));
}
