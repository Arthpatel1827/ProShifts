// src/screens/ClockPinScreen.tsx
// The employee's personal 4-digit PIN for the store's ProShifts Punch In tablet.
// It's sent once over HTTPS and stored as a keyed hash; nobody (managers included) can see it.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { KioskAPI } from '../api/api';

function PinBoxes({ value, onChange, label, autoFocus, inputRef, onDone }: {
    value: string; onChange: (v: string) => void; label: string; autoFocus?: boolean;
    inputRef?: React.RefObject<React.ComponentRef<typeof TextInput> | null>; onDone?: () => void;
}) {
    const local = useRef<React.ComponentRef<typeof TextInput>>(null);
    const ref = inputRef ?? local;
    return (
        <View style={styles.block}>
            <Text style={styles.label}>{label}</Text>
            <Pressable style={styles.boxes} onPress={() => ref.current?.focus()} accessibilityLabel={`${label}, ${value.length} of 4 digits`}>
                {[0, 1, 2, 3].map(i => (
                    <View key={i} style={[styles.box, i === value.length && styles.boxActive]}>
                        <Text style={styles.boxText}>{value[i] ? '•' : ''}</Text>
                    </View>
                ))}
            </Pressable>
            {/* One hidden numeric field drives the four boxes. */}
            <TextInput
                ref={ref}
                value={value}
                onChangeText={t => {
                    const v = t.replace(/\D/g, '').slice(0, 4);
                    onChange(v);
                    if (v.length === 4) onDone?.();
                }}
                keyboardType="number-pad"
                maxLength={4}
                autoFocus={autoFocus}
                secureTextEntry
                style={styles.hiddenInput}
                textContentType="oneTimeCode"
            />
        </View>
    );
}

export default function ClockPinScreen({ navigation }: any) {
    const [status, setStatus] = useState<{ is_set: boolean; set_at: string | null } | null>(null);
    const [pin, setPin] = useState('');
    const [confirm, setConfirm] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const confirmRef = useRef<React.ComponentRef<typeof TextInput>>(null);

    const load = useCallback(async () => {
        try {
            const { data } = await KioskAPI.pinStatus();
            setStatus(data);
        } catch {
            setStatus({ is_set: false, set_at: null });
        }
    }, []);
    useEffect(() => { load(); }, [load]);

    const save = async () => {
        setError(null);
        if (pin.length !== 4) return setError('Enter 4 digits.');
        if (pin !== confirm) return setError("The two PINs don't match.");
        setSaving(true);
        try {
            const { data } = await KioskAPI.setPin(pin, confirm);
            setStatus(data);
            setPin('');
            setConfirm('');
            Alert.alert('PIN saved ✓', 'Use it on the ProShifts Punch In tablet at work.');
        } catch (e: any) {
            setError(e?.response?.status === 429
                ? 'Too many changes. Try again later.'
                : e?.response?.data?.error ?? "Couldn't save your PIN.");
        } finally {
            setSaving(false);
        }
    };

    return (
        <SafeAreaView style={styles.safe}>
            <View style={styles.header}>
                <Pressable onPress={() => navigation.goBack()} style={styles.back} accessibilityLabel="Back">
                    <Ionicons name="arrow-back" size={22} color={colors.text} />
                </Pressable>
                <Text style={styles.title}>Clock-in PIN</Text>
            </View>

            <View style={styles.body}>
                <View style={styles.intro}>
                    <Ionicons name="keypad-outline" size={28} color={colors.primary} />
                    <Text style={styles.introText}>
                        Your personal PIN for the punch-in tablet at work.{'\n'}Keep it to yourself — nobody else can see it, not even managers.
                    </Text>
                </View>
                {status === null ? (
                    <ActivityIndicator color={colors.primary} />
                ) : (
                    <Text style={styles.status}>
                        {status.is_set ? 'You have a PIN. Enter a new one to change it.' : "You haven't set a PIN yet."}
                    </Text>
                )}

                <PinBoxes label={status?.is_set ? 'New PIN' : 'Create your clock-in PIN'} value={pin} onChange={setPin}
                    autoFocus onDone={() => confirmRef.current?.focus()} />
                <PinBoxes label="Confirm PIN" value={confirm} onChange={setConfirm} inputRef={confirmRef} />

                {error && <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text>}

                <Pressable
                    style={[styles.saveBtn, (saving || pin.length < 4 || confirm.length < 4) && { opacity: 0.5 }]}
                    onPress={save}
                    disabled={saving || pin.length < 4 || confirm.length < 4}
                >
                    {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>Save</Text>}
                </Pressable>
                <Text style={styles.hint}>Avoid easy PINs like 1234 or 0000.</Text>
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.background },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#F0F0F0' },
    back: { padding: 4, marginRight: 8 },
    title: { fontSize: 18, fontWeight: '700', color: colors.text },
    body: { padding: 20, gap: 18 },
    intro: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', backgroundColor: colors.subtleAccent, padding: 14, borderRadius: 12 },
    introText: { flex: 1, fontSize: 13, color: colors.text, lineHeight: 19 },
    status: { fontSize: 13, color: colors.gray },
    block: { gap: 8 },
    label: { fontSize: 14, fontWeight: '700', color: colors.text },
    boxes: { flexDirection: 'row', gap: 12 },
    box: { width: 56, height: 64, borderRadius: 12, borderWidth: 1.5, borderColor: colors.inputBorder, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
    boxActive: { borderColor: colors.primary },
    boxText: { fontSize: 28, fontWeight: '800', color: colors.text },
    hiddenInput: { position: 'absolute', opacity: 0, width: 1, height: 1 },
    error: { color: colors.error, fontSize: 13, fontWeight: '600' },
    saveBtn: { backgroundColor: colors.primary, borderRadius: 999, paddingVertical: 14, alignItems: 'center' },
    saveText: { color: '#fff', fontWeight: '700', fontSize: 15 },
    hint: { fontSize: 12, color: colors.gray, textAlign: 'center' },
});
