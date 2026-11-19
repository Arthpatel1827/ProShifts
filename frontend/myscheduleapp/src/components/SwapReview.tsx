// src/components/SwapReview.tsx
// Shows what a swap does to each person's schedule, as the server calculated it on the
// schedule AFTER the swap. A hard conflict (overlap, time off) means it can't be sent.
import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';

export type SwapShiftRef = {
    shift_id: number;
    start_time: string;
    end_time: string;
    role?: string | null;
    location?: string | null;
};

export type SwapSide = {
    user_id: number;
    name: string | null;
    ok: boolean;
    errors: { code: string; message: string }[];
    availability: string | null;
    warnings: { code: string; message: string }[];
    gives: SwapShiftRef | null;
    receives: SwapShiftRef | null;
};

export type SwapValidation = {
    ok: boolean;
    needs_override: boolean;
    errors: string[];
    availability: string[];
    warnings: string[];
    requester: SwapSide | null;
    receiver: SwapSide | null;
};

function fmt(ref: SwapShiftRef | null) {
    if (!ref) return '—';
    const s = new Date(ref.start_time);
    const e = new Date(ref.end_time);
    const day = s.toLocaleDateString('en-CA', { weekday: 'long', month: 'short', day: 'numeric' });
    const t = (d: Date) => d.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit', hour12: true });
    return `${day}\n${t(s)} – ${t(e)}${ref.role ? ` · ${ref.role}` : ''}`;
}

export default function SwapReview({
    validation, loading, error, perspective = 'requester',
}: {
    validation: SwapValidation | null;
    loading?: boolean;
    error?: string | null;
    /** Whose "you give / you receive" this is. */
    perspective?: 'requester' | 'receiver' | 'manager';
}) {
    if (loading) {
        return (
            <View style={[styles.card, styles.center]}>
                <ActivityIndicator color={colors.primary} />
                <Text style={styles.muted}>Checking both schedules…</Text>
            </View>
        );
    }
    if (error) {
        return (
            <View style={[styles.card, styles.bad]}>
                <Text style={styles.badText}>{error}</Text>
            </View>
        );
    }
    if (!validation) return null;

    const me = perspective === 'receiver' ? validation.receiver : validation.requester;
    const blocked = validation.errors.length > 0;
    const cautions = [...validation.availability, ...validation.warnings];

    return (
        <View style={styles.card} accessibilityLabel="Swap review">
            <Text style={styles.title}>Swap Review</Text>
            {perspective !== 'manager' && me && (
                <View style={styles.row}>
                    <View style={styles.col}>
                        <Text style={styles.label}>You give</Text>
                        <Text style={styles.value}>{fmt(me.gives)}</Text>
                    </View>
                    <Ionicons name="swap-horizontal" size={18} color={colors.gray} />
                    <View style={styles.col}>
                        <Text style={styles.label}>You receive</Text>
                        <Text style={styles.value}>{fmt(me.receives)}</Text>
                    </View>
                </View>
            )}

            {blocked ? (
                <View style={[styles.banner, styles.bad]}>
                    <Ionicons name="alert-circle" size={18} color={colors.error} />
                    <View style={{ flex: 1 }}>
                        <Text style={styles.badTitle}>Conflict detected</Text>
                        {validation.errors.map(e => (
                            <Text key={e} style={styles.badText}>{e}</Text>
                        ))}
                        <Text style={styles.badText}>This swap can't be submitted.</Text>
                    </View>
                </View>
            ) : (
                <View style={[styles.banner, styles.good]}>
                    <Ionicons name="checkmark-circle" size={18} color={colors.success} />
                    <Text style={styles.goodText}>No overlapping shifts or time off for either of you.</Text>
                </View>
            )}

            {cautions.length > 0 && (
                <View style={[styles.banner, styles.warn]}>
                    <Ionicons name="warning" size={18} color={colors.warning} />
                    <View style={{ flex: 1 }}>
                        {cautions.map(c => (
                            <Text key={c} style={styles.warnText}>{c}</Text>
                        ))}
                        {validation.needs_override && (
                            <Text style={styles.warnText}>A manager has to confirm this when approving.</Text>
                        )}
                    </View>
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        marginHorizontal: 16, marginTop: 12, padding: 14, borderRadius: 12,
        backgroundColor: '#fff', borderWidth: 1, borderColor: '#EEE', gap: 10,
    },
    center: { alignItems: 'center', gap: 8 },
    title: { fontSize: 14, fontWeight: '800', color: colors.text },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    col: { flex: 1 },
    label: { fontSize: 11, fontWeight: '700', color: colors.gray, textTransform: 'uppercase' },
    value: { fontSize: 13, color: colors.text, marginTop: 2, lineHeight: 18 },
    banner: { flexDirection: 'row', gap: 8, padding: 10, borderRadius: 10 },
    bad: { backgroundColor: '#FEF2F2' },
    badTitle: { fontSize: 13, fontWeight: '800', color: '#991B1B' },
    badText: { fontSize: 12, color: '#991B1B', marginTop: 2 },
    good: { backgroundColor: '#ECFDF5', alignItems: 'center' },
    goodText: { flex: 1, fontSize: 12, color: '#065F46' },
    warn: { backgroundColor: '#FFFBEB' },
    warnText: { fontSize: 12, color: '#92400E', marginTop: 2 },
    muted: { fontSize: 12, color: colors.gray },
});
