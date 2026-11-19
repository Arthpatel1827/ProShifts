// Run: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitShifts, workingDays } from '../timelineSegments';
import { addDaysKey } from '../zoned';

const TZ = 'America/Toronto';
const MON = '2026-11-02'; // a Monday; EST (UTC-5) all week
const WEEK = Array.from({ length: 7 }, (_, i) => addDaysKey(MON, i));
// Local wall-clock → UTC ISO for Toronto in this (EST) week.
const at = (day: string, hh: number) => new Date(`${day}T${String(hh).padStart(2, '0')}:00:00-05:00`).toISOString();
const shift = (id: number, day: string, startH: number, hours: number) => {
    const start = at(day, startH);
    return { shift_id: id, start_time: start, end_time: new Date(Date.parse(start) + hours * 3_600_000).toISOString(), status: 'published' };
};

test('previous Sunday 10 PM → Monday 6 AM shows Monday 00:00–06:00, one shift', () => {
    const s = shift(1, addDaysKey(MON, -1), 22, 8);
    const segs = splitShifts([s], TZ, WEEK);
    assert.equal(segs.length, 1);
    assert.deepEqual({ day: segs[0].day, from: segs[0].from, to: segs[0].to, continued: segs[0].continued },
        { day: MON, from: 0, to: 360, continued: true });
    assert.equal(segs[0].shift, s); // the same record, not a copy
    assert.ok(workingDays([s], TZ, WEEK).has(MON));
});

for (const [name, offset] of [['Mon → Tue', 0], ['Tue → Wed', 1], ['Sat → Sun', 5]] as const) {
    test(`${name}: evening on the start day, early hours on the next, same shift`, () => {
        const s = shift(2, addDaysKey(MON, offset), 22, 8);
        const segs = splitShifts([s], TZ, WEEK);
        assert.equal(segs.length, 2);
        assert.deepEqual(segs.map(g => [g.day, g.from, g.to, g.continues, g.continued]), [
            [addDaysKey(MON, offset), 22 * 60, 1440, true, false],
            [addDaysKey(MON, offset + 1), 0, 360, false, true],
        ]);
        assert.ok(segs.every(g => g.shift === s));
    });
}

test('Sunday → Monday: this week shows Sunday evening; next week shows Monday morning', () => {
    const s = shift(3, addDaysKey(MON, 6), 22, 8);
    assert.deepEqual(splitShifts([s], TZ, WEEK).map(g => [g.day, g.from, g.to]), [[addDaysKey(MON, 6), 1320, 1440]]);
    const next = WEEK.map(d => addDaysKey(d, 7));
    assert.deepEqual(splitShifts([s], TZ, next).map(g => [g.day, g.from, g.to]), [[addDaysKey(MON, 7), 0, 360]]);
});

test('a shift listed twice is drawn once; cancelled shifts are not drawn', () => {
    const s = shift(4, MON, 9, 8);
    const c = { ...shift(5, MON, 12, 4), status: 'cancelled' };
    assert.equal(splitShifts([s, s, c], TZ, WEEK).length, 1);
});

test('day shift: one part, whole day off elsewhere', () => {
    const s = shift(6, MON, 9, 8);
    assert.deepEqual(splitShifts([s], TZ, WEEK).map(g => [g.day, g.from, g.to, g.continues]), [[MON, 540, 1020, false]]);
    assert.equal(workingDays([s], TZ, WEEK).size, 1);
});
