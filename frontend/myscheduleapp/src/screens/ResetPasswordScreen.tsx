import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { AuthAPI } from '../api/api';

export default function ResetPasswordScreen({ navigation, route }: any) {
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const token = route.params?.token;

    const handleSubmit = async () => {
        if (newPassword.length < 8) {
            setError('Password must be at least 8 characters.');
            return;
        }
        if (newPassword !== confirmPassword) {
            setError('Passwords do not match.');
            return;
        }
        setError('');
        setLoading(true);
        try {
            await AuthAPI.resetPassword(token, newPassword, confirmPassword);
            navigation.navigate('PasswordChanged');
        } catch (e: any) {
            setError(e?.response?.data?.error || 'Reset failed');
        } finally {
            setLoading(false);
        }
    };

    return (
        <View style={styles.container}>
            <Text style={styles.title}>Create new password</Text>
            <Text style={styles.subtitle}>Enter and confirm your new password</Text>

            <TextInput placeholder="New password" secureTextEntry style={styles.input}
                onChangeText={setNewPassword} value={newPassword} />
            <TextInput placeholder="Confirm password" secureTextEntry style={styles.input}
                onChangeText={setConfirmPassword} value={confirmPassword} />

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <TouchableOpacity style={styles.button} onPress={handleSubmit}>
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Update Password</Text>}
            </TouchableOpacity>
        </View>
    );
}

const PURPLE = '#7B4AE2';
const styles = StyleSheet.create({
    container: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#fff' },
    title: { fontSize: 22, color: PURPLE, fontWeight: '600', marginBottom: 8 },
    subtitle: { color: '#777', marginBottom: 16 },
    input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12, marginBottom: 16 },
    button: { backgroundColor: PURPLE, borderRadius: 8, alignItems: 'center', paddingVertical: 14 },
    btnText: { color: '#fff', fontWeight: '600' },
    error: { color: 'red', fontSize: 13 },
});
