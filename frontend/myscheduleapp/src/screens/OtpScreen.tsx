import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';

export default function OtpScreen({ navigation, route }: any) {
    const [otp, setOtp] = useState('');

    const [error, setError] = useState('');

    // The backend verifies the code together with the new password
    // (POST /auth/forgot-password/confirm), so here we only check its shape.
    const handleNext = () => {
        if (!/^\d{6}$/.test(otp)) {
            setError('Enter the 6-digit code from your email.');
            return;
        }
        setError('');
        navigation.navigate('ResetPassword', { token: otp });
    };

    return (
        <View style={styles.container}>
            <Text style={styles.title}>Enter OTP</Text>
            <Text style={styles.subtitle}>Enter the 6-digit code sent to your email.</Text>

            <TextInput
                style={styles.input}
                keyboardType="numeric"
                maxLength={6}
                placeholder="Enter code"
                onChangeText={t => setOtp(t.replace(/\D/g, ''))}
                value={otp}
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <TouchableOpacity
                style={[styles.button, otp.length !== 6 && { opacity: 0.5 }]}
                onPress={handleNext}
                disabled={otp.length !== 6}
            >
                <Text style={styles.btnText}>Next</Text>
            </TouchableOpacity>
        </View>
    );
}

const PURPLE = '#7B4AE2';
const styles = StyleSheet.create({
    container: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#fff' },
    title: { fontSize: 22, color: PURPLE, fontWeight: '600', marginBottom: 8 },
    subtitle: { color: '#777', marginBottom: 16 },
    input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12, marginBottom: 16, textAlign: 'center', fontSize: 18, letterSpacing: 6 },
    button: { backgroundColor: PURPLE, borderRadius: 8, alignItems: 'center', paddingVertical: 14 },
    btnText: { color: '#fff', fontWeight: '600' },
    error: { color: '#EF4444', marginBottom: 12, textAlign: 'center' },
});
