// src/components/schedule/WeekTimeline.tsx
// "My week at a glance": days down the side, time of day across, one coloured block per
// shift (colour = role). It always fits the phone's width — the time axis covers only
// the hours this week actually uses — so there's no sideways scrolling. Swipe left/right
// to change week; tap a block for the details.
import React, { useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, PanResponder, LayoutChangeEvent } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { roleColor } from '../../theme/roleColors';
import { addDaysKey, clockLabel, formatKey, minutesIn, todayKeyIn } from '../../utils/zoned';
import { Segment as Seg, splitShifts } from '../../utils/timelineSegments';

export type TimelineShift = {
    shift_id: number;
    role?: string | null;
    start_time: string;
    end_time: string;
    break_minutes: number;
    status: string;
    timezone?: string;
};

type Segment = Seg<TimelineShift>;

const DAY_W = 46;
const ROW_H = 56;
const MIN_SPAN_H = 8;

export default function WeekTimeline({ weekStart, shifts, tz, onShiftPress, onSwipe }: {
    weekStart: string;
    shifts: TimelineShift[];
    tz?: string;
    onShiftPress: (s: TimelineShift) => void;
    onSwipe?: (dir: -1 | 1) => void;
}) {
    const [width, setWidth] = useState(0);
    const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDaysKey(weekStart, i)), [weekStart]);
    const today = todayKeyIn(tz);

    // Overnight shifts are split at midnight so each day row shows its own part — including
    // a shift from the night before this week (its Monday part). Still one shift each.
    const segments = useMemo(() => splitShifts(shifts, tz, days), [shifts, tz, days]);

    // Hours shown: what this week uses, at least 8 h, on whole hours.
    const [axisFrom, axisTo] = useMemo(() => {
        const inWeek = segments.filter(g => days.includes(g.day));
        if (!inWeek.length) return [9 * 60, 17 * 60];
        let lo = Math.floor(Math.min(...inWeek.map(g => g.from)) / 60) * 60;
        let hi = Math.ceil(Math.max(...inWeek.map(g => g.to)) / 60) * 60;
        while (hi - lo < MIN_SPAN_H * 60) {
            if (lo > 0) lo -= 60;
            if (hi - lo < MIN_SPAN_H * 60 && hi < 1440) hi += 60;
            if (lo === 0 && hi === 1440) break;
        }
        return [lo, hi];
    }, [segments, days]);

    const trackW = Math.max(width - DAY_W, 1);
    const x = (min: number) => ((min - axisFrom) / (axisTo - axisFrom)) * trackW;
    const spanH = (axisTo - axisFrom) / 60;
    const step = spanH > 16 ? 4 : spanH > 10 ? 3 : 2;
    const ticks: number[] = [];
    for (let m = axisFrom; m <= axisTo; m += step * 60) ticks.push(m);

    // Horizontal swipe changes week; vertical movement stays with the page scroll.
    const pan = useRef(
        PanResponder.create({
            // Capture phase: take clearly-horizontal drags even when they start on a shift block.
            onMoveShouldSetPanResponderCapture: (_e, g) => Math.abs(g.dx) > 24 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
            onPanResponderTerminationRequest: () => false,
            onPanResponderRelease: (_e, g) => {
                if (Math.abs(g.dx) > 60) onSwipeRef.current?.(g.dx < 0 ? 1 : -1);
            },
        })
    ).current;
    const onSwipeRef = useRef(onSwipe);
    onSwipeRef.current = onSwipe;

    const nowMin = minutesIn(new Date(), tz);

    return (
        <View onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)} {...pan.panHandlers} accessibilityLabel="My week timeline">
            {/* Time axis */}
            <View style={[styles.axis, { marginLeft: DAY_W }]}>
                {width > 0 && ticks.map(t => (
                    <Text key={t} style={[styles.tick, { left: Math.min(Math.max(x(t) - 18, -4), trackW - 34) }]}>{clockLabel(t)}</Text>
                ))}
            </View>

            {days.map(day => {
                const isToday = day === today;
                const segs = segments.filter(g => g.day === day);
                const off = segs.length === 0;
                return (
                    <View key={day} style={[styles.row, isToday && styles.rowToday]}>
                        <View style={styles.dayCol}>
                            <Text style={[styles.dayName, isToday && styles.todayText]}>{formatKey(day, { weekday: 'short' }).toUpperCase()}</Text>
                            <Text style={[styles.dayNum, isToday && styles.todayText]}>{Number(day.slice(8, 10))}</Text>
                        </View>
                        <View style={styles.track}>
                            {width > 0 && ticks.map(t => <View key={t} style={[styles.grid, { left: x(t) }]} />)}
                            {off && <Text style={styles.off}>Day off</Text>}
                            {width > 0 && segs.map(g => {
                                const c = roleColor(g.shift.role);
                                const left = x(Math.max(g.from, axisFrom));
                                const w = Math.max(x(Math.min(g.to, axisTo)) - left, 6);
                                const draft = g.shift.status === 'draft';
                                const label = blockLabel(g, w);
                                return (
                                    <Pressable
                                        key={`${g.shift.shift_id}-${g.continued ? 'b' : 'a'}`}
                                        onPress={() => onShiftPress(g.shift)}
                                        accessibilityRole="button"
                                        accessibilityLabel={`${formatKey(day, { weekday: 'long' })}, ${g.shift.role ?? 'Shift'}, ${clockLabel(g.from)} to ${clockLabel(g.to)}${g.continues ? ', continues next day' : ''}`}
                                        style={({ pressed }) => [
                                            styles.block,
                                            { left, width: w, backgroundColor: c.fill, borderLeftColor: c.solid },
                                            draft && styles.blockDraft,
                                            pressed && { opacity: 0.75 },
                                        ]}
                                    >
                                        {label && (
                                            <Text style={[styles.blockTime, { color: c.text }]} numberOfLines={1}>{label}</Text>
                                        )}
                                        {w > 60 && g.shift.role && (
                                            <Text style={[styles.blockRole, { color: c.text }]} numberOfLines={1}>{g.shift.role}</Text>
                                        )}
                                        {g.continues && <Ionicons name="moon" size={10} color={c.text} style={styles.moon} />}
                                    </Pressable>
                                );
                            })}
                            {isToday && width > 0 && nowMin >= axisFrom && nowMin <= axisTo && (
                                <View style={[styles.now, { left: x(nowMin) }]} accessibilityLabel="Now" />
                            )}
                        </View>
                    </View>
                );
            })}
        </View>
    );
}

/** The longest time label that fits the block: "7 AM–1 PM", "7a–1p", "3–7p", "3 PM", or none. */
function blockLabel(g: Segment, width: number): string | null {
    const room = width - 12;
    const fits = (t: string) => t.length * 7.4 <= room; // ~11px bold glyphs
    if (g.continued) {
        const t = `→ ${clockLabel(g.to)}`;
        return fits(t) ? t : fits(`→ ${short(g.to)}`) ? `→ ${short(g.to)}` : null;
    }
    const full = `${clockLabel(g.from)}–${clockLabel(g.to)}`;
    if (fits(full)) return full;
    const a = short(g.from), b = short(g.to);
    const compact = a.slice(-1) === b.slice(-1) ? `${a.slice(0, -1)}–${b}` : `${a}–${b}`;
    if (fits(compact)) return compact;
    return fits(a) ? a : null;
}

/** "7a", "1:30p" */
function short(min: number) {
    const l = clockLabel(min);
    return `${l.slice(0, -3)}${l.slice(-2, -1).toLowerCase()}`;
}

const styles = StyleSheet.create({
    axis: { height: 18, position: 'relative' },
    tick: { position: 'absolute', width: 40, fontSize: 9, color: colors.gray, textAlign: 'center' },
    row: { flexDirection: 'row', height: ROW_H, borderBottomWidth: 1, borderBottomColor: '#F1F1F5' },
    rowToday: { backgroundColor: '#F7F3FF' },
    dayCol: { width: DAY_W, alignItems: 'center', justifyContent: 'center' },
    dayName: { fontSize: 10, fontWeight: '700', color: colors.gray },
    dayNum: { fontSize: 16, fontWeight: '800', color: colors.text },
    todayText: { color: colors.primary },
    track: { flex: 1, position: 'relative', justifyContent: 'center' },
    grid: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: '#ECECF2' },
    off: { fontSize: 12, color: '#B0B0BE', marginLeft: 8, fontStyle: 'italic' },
    block: {
        position: 'absolute', top: 7, bottom: 7, borderRadius: 8, borderLeftWidth: 4,
        paddingHorizontal: 5, justifyContent: 'center', overflow: 'hidden',
    },
    blockDraft: { borderStyle: 'dashed', opacity: 0.8 },
    blockTime: { fontSize: 11, fontWeight: '700' },
    blockRole: { fontSize: 10, fontWeight: '500' },
    moon: { position: 'absolute', right: 4, top: 4 },
    now: { position: 'absolute', top: 2, bottom: 2, width: 2, backgroundColor: colors.error, borderRadius: 1 },
});
