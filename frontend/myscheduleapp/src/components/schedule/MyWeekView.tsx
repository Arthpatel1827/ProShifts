// src/components/schedule/MyWeekView.tsx
// The employee's own week: today at a glance, the visual timeline, a role legend and a
// details sheet. Data: GET /shifts/mine (published shifts only), times at the location.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Modal, ActivityIndicator, ScrollView, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { roleColor } from '../../theme/roleColors';
import { ShiftsAPI } from '../../api/api';
import WeekTimeline, { TimelineShift } from './WeekTimeline';
import { addDaysKey, dateKeyIn, formatKey, mondayKey, timeIn, todayKeyIn } from '../../utils/zoned';

type MyShift = TimelineShift & {
    notes?: string | null;
    location_name?: string | null;
    breaks?: { break_id: number; start_time: string; end_time: string; minutes: number }[];
};

const paidHours = (s: MyShift) =>
    Math.max((new Date(s.end_time).getTime() - new Date(s.start_time).getTime()) / 3_600_000 - (s.break_minutes || 0) / 60, 0);
const fmtH = (h: number) => `${Math.round(h * 10) / 10}h`;

export default function MyWeekView() {
    const [tz, setTz] = useState<string | undefined>(undefined);
    const [week, setWeek] = useState(() => mondayKey(todayKeyIn()));
    const [shifts, setShifts] = useState<MyShift[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [open, setOpen] = useState<MyShift | null>(null);

    const load = useCallback(async (wk: string) => {
        setError(null);
        try {
            const { data } = await ShiftsAPI.mine(wk);
            const list: MyShift[] = data?.shifts ?? [];
            setShifts(list);
            if (list[0]?.timezone) setTz(list[0].timezone);
        } catch (e: any) {
            setError(e?.response?.data?.error ?? "Couldn't load your schedule.");
        }
    }, []);

    useEffect(() => {
        setLoading(true);
        load(week).finally(() => setLoading(false));
    }, [week, load]);

    const today = todayKeyIn(tz);
    const thisWeek = mondayKey(today);
    const todays = useMemo(() => shifts.filter(s => dateKeyIn(s.start_time, tz) === today), [shifts, tz, today]);
    const total = shifts.reduce((n, s) => n + paidHours(s), 0);
    const daysOff = 7 - new Set(shifts.map(s => dateKeyIn(s.start_time, tz))).size;
    const roles = useMemo(() => Array.from(new Set(shifts.map(s => s.role).filter(Boolean))) as string[], [shifts]);
    const range = `${formatKey(week, { month: 'short', day: 'numeric' })} – ${formatKey(addDaysKey(week, 6), { month: 'short', day: 'numeric' })}`;

    const go = (n: -1 | 1) => setWeek(w => addDaysKey(w, 7 * n));

    return (
        <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: 32 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(week); setRefreshing(false); }} />}
        >
            <View style={styles.weekNav}>
                <Pressable onPress={() => go(-1)} style={styles.navBtn} accessibilityLabel="Previous week">
                    <Ionicons name="chevron-back" size={20} color={colors.text} />
                </Pressable>
                <View style={{ alignItems: 'center' }}>
                    <Text style={styles.range}>{range}</Text>
                    {week !== thisWeek && (
                        <Pressable onPress={() => setWeek(thisWeek)}><Text style={styles.backToday}>Back to this week</Text></Pressable>
                    )}
                </View>
                <Pressable onPress={() => go(1)} style={styles.navBtn} accessibilityLabel="Next week">
                    <Ionicons name="chevron-forward" size={20} color={colors.text} />
                </Pressable>
            </View>

            {week === thisWeek && (
                <View style={styles.todayCard}>
                    <Text style={styles.todayLabel}>TODAY</Text>
                    {todays.length ? todays.map(s => {
                        const c = roleColor(s.role);
                        return (
                            <Pressable key={s.shift_id} onPress={() => setOpen(s)} style={styles.todayRow}>
                                <View style={[styles.dot, { backgroundColor: c.solid }]} />
                                <Text style={styles.todayTime}>{timeIn(s.start_time, tz)} – {timeIn(s.end_time, tz)}</Text>
                                <Text style={styles.todayRole} numberOfLines={1}>{s.role ?? 'Shift'}</Text>
                                <Ionicons name="chevron-forward" size={16} color={colors.gray} />
                            </Pressable>
                        );
                    }) : <Text style={styles.todayOff}>No shift today — enjoy your day off.</Text>}
                </View>
            )}

            <View style={styles.summary}>
                <Text style={styles.summaryText}><Text style={styles.summaryNum}>{shifts.length}</Text> shift{shifts.length === 1 ? '' : 's'}</Text>
                <Text style={styles.summaryText}><Text style={styles.summaryNum}>{fmtH(total)}</Text> paid</Text>
                <Text style={styles.summaryText}><Text style={styles.summaryNum}>{daysOff}</Text> day{daysOff === 1 ? '' : 's'} off</Text>
            </View>

            <View style={styles.card}>
                {loading ? (
                    <ActivityIndicator style={{ padding: 40 }} color={colors.primary} />
                ) : error ? (
                    <Text style={styles.error}>{error}</Text>
                ) : (
                    <WeekTimeline weekStart={week} shifts={shifts} tz={tz} onShiftPress={s => setOpen(s as MyShift)} onSwipe={go} />
                )}
                {!loading && !error && shifts.length === 0 && (
                    <Text style={styles.empty}>No shifts this week. Swipe or use the arrows to see other weeks.</Text>
                )}
            </View>

            {roles.length > 0 && (
                <View style={styles.legend} accessibilityLabel="Role colours">
                    {roles.map(r => (
                        <View key={r} style={styles.legendItem}>
                            <View style={[styles.dot, { backgroundColor: roleColor(r).solid }]} />
                            <Text style={styles.legendText}>{r}</Text>
                        </View>
                    ))}
                </View>
            )}
            <Text style={styles.hint}>Swipe left or right to change week · tap a shift for details</Text>

            <Modal visible={!!open} transparent animationType="slide" onRequestClose={() => setOpen(null)}>
                <Pressable style={styles.backdrop} onPress={() => setOpen(null)}>
                    {open && (
                        <Pressable style={styles.sheet} onPress={() => {}}>
                            <View style={[styles.sheetBar, { backgroundColor: roleColor(open.role).solid }]} />
                            <Text style={styles.sheetDate}>{formatKey(dateKeyIn(open.start_time, tz), { weekday: 'long', month: 'long', day: 'numeric' })}</Text>
                            <Text style={styles.sheetTime}>{timeIn(open.start_time, tz)} – {timeIn(open.end_time, tz)}
                                {dateKeyIn(open.end_time, tz) !== dateKeyIn(open.start_time, tz) ? '  (ends next day)' : ''}</Text>
                            <Detail icon="briefcase-outline" label="Role" value={open.role ?? 'Any role'} />
                            <Detail icon="location-outline" label="Location" value={open.location_name ?? '—'} />
                            <Detail icon="cafe-outline" label="Break" value={
                                open.breaks?.length
                                    ? open.breaks.map(b => `${timeIn(b.start_time, tz)}–${timeIn(b.end_time, tz)}`).join(', ')
                                    : open.break_minutes ? `${open.break_minutes} min` : 'No break scheduled'} />
                            <Detail icon="time-outline" label="Paid time" value={fmtH(paidHours(open))} />
                            <Detail icon="checkmark-circle-outline" label="Status" value={open.status === 'published' ? 'Confirmed' : open.status} />
                            {open.notes ? <Detail icon="document-text-outline" label="Notes" value={open.notes} /> : null}
                            <Pressable style={styles.closeBtn} onPress={() => setOpen(null)}><Text style={styles.closeText}>Close</Text></Pressable>
                        </Pressable>
                    )}
                </Pressable>
            </Modal>
        </ScrollView>
    );
}

function Detail({ icon, label, value }: { icon: any; label: string; value: string }) {
    return (
        <View style={styles.detail}>
            <Ionicons name={icon} size={16} color={colors.gray} />
            <Text style={styles.detailLabel}>{label}</Text>
            <Text style={styles.detailValue}>{value}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    weekNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingVertical: 8 },
    navBtn: { padding: 8 },
    range: { fontSize: 14, fontWeight: '700', color: colors.text },
    backToday: { fontSize: 11, color: colors.primary, fontWeight: '600', marginTop: 2 },
    todayCard: { marginHorizontal: 16, padding: 12, borderRadius: 12, backgroundColor: colors.subtleAccent, gap: 6 },
    todayLabel: { fontSize: 10, fontWeight: '800', color: colors.primary, letterSpacing: 1 },
    todayRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    todayTime: { fontSize: 15, fontWeight: '800', color: colors.text },
    todayRole: { flex: 1, fontSize: 13, color: colors.gray },
    todayOff: { fontSize: 13, color: colors.text },
    dot: { width: 10, height: 10, borderRadius: 5 },
    summary: { flexDirection: 'row', justifyContent: 'space-around', marginHorizontal: 16, marginTop: 12 },
    summaryText: { fontSize: 12, color: colors.gray },
    summaryNum: { fontSize: 15, fontWeight: '800', color: colors.text },
    card: { marginHorizontal: 12, marginTop: 12, paddingVertical: 8, paddingRight: 8, borderRadius: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: '#EEE' },
    error: { color: colors.error, padding: 16, textAlign: 'center' },
    empty: { fontSize: 12, color: colors.gray, textAlign: 'center', paddingHorizontal: 16, paddingBottom: 8 },
    legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginHorizontal: 16, marginTop: 12 },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    legendText: { fontSize: 12, color: colors.text },
    hint: { fontSize: 11, color: colors.gray, textAlign: 'center', marginTop: 10 },
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
    sheet: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 32, gap: 10 },
    sheetBar: { height: 4, width: 48, borderRadius: 2, alignSelf: 'center', marginBottom: 6 },
    sheetDate: { fontSize: 13, fontWeight: '700', color: colors.gray },
    sheetTime: { fontSize: 22, fontWeight: '800', color: colors.text },
    detail: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
    detailLabel: { width: 72, fontSize: 13, color: colors.gray },
    detailValue: { flex: 1, fontSize: 13, color: colors.text, fontWeight: '600' },
    closeBtn: { marginTop: 8, paddingVertical: 12, borderRadius: 999, backgroundColor: colors.subtleAccent, alignItems: 'center' },
    closeText: { color: colors.primary, fontWeight: '700' },
});
