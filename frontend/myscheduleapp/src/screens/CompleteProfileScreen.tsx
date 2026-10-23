// src/screens/CompleteProfileScreen.tsx
import React, { useContext, useEffect, useState } from 'react';
import {
    View,
    Text,
    TextInput,
    StyleSheet,
    Pressable,
    ActivityIndicator,
    Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '../theme/colors';
import { AuthContext } from '../context/AuthContext';
import { AuthAPI } from '../api/api';

export default function CompleteProfileScreen({ navigation }: any) {
    const { user, setUser } = useContext(AuthContext);

    const [displayName, setDisplayName] = useState(user?.display_name ?? '');
    const [loading, setLoading] = useState(false);

    // keep local state in sync if user changes in context
    useEffect(() => {
        setDisplayName(user?.display_name ?? '');
    }, [user?.display_name]);

    // UPDATE_PROFILE_MUTATION never existed in graphql/operations, so this screen used to
    // crash. Save through the existing REST endpoint (PATCH /auth/profile) instead.
    const handleSave = async () => {
        const trimmedName = displayName.trim();

        if (!trimmedName) {
            Alert.alert('Missing name', 'Please enter your display name.');
            return;
        }
        if (trimmedName.length > 60) {
            Alert.alert('Name too long', 'Display names must be under 60 characters.');
            return;
        }

        setLoading(true);
        try {
            await AuthAPI.updateProfile(trimmedName);
            setUser(prev => (prev ? { ...prev, display_name: trimmedName } : prev));

            Alert.alert('Profile updated', 'Your profile has been saved.', [
                {
                    text: 'OK',
                    onPress: () => navigation.goBack?.(),
                },
            ]);
        } catch (err: any) {
            Alert.alert(
                'Error',
                err?.response?.data?.error || 'Could not update your profile. Please try again.',
            );
        } finally {
            setLoading(false);
        }
    };

    return (
        <SafeAreaView style={styles.safe}>
            <View style={styles.container}>
                <Text style={styles.title}>Complete your profile</Text>
                <Text style={styles.subtitle}>
                    Add a friendly display name so your team can recognize you.
                </Text>

                <Text style={styles.label}>Display name</Text>
                <TextInput
                    value={displayName}
                    onChangeText={setDisplayName}
                    placeholder="e.g. Neel Shah"
                    placeholderTextColor={colors.gray}
                    maxLength={60}
                    style={styles.input}
                />
                <Text style={styles.hint}>
                    Your manager keeps your phone and emergency contact on your employee profile.
                </Text>

                <Pressable
                    style={({ pressed }) => [
                        styles.primaryButton,
                        pressed && { opacity: 0.9 },
                    ]}
                    onPress={handleSave}
                    disabled={loading}
                >
                    {loading ? (
                        <ActivityIndicator color={colors.buttonText} />
                    ) : (
                        <Text style={styles.primaryButtonText}>Save profile</Text>
                    )}
                </Pressable>
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.background },
    container: {
        flex: 1,
        padding: 16,
    },
    title: {
        fontSize: 22,
        fontWeight: '800',
        color: colors.text,
        marginBottom: 6,
    },
    subtitle: {
        fontSize: 13,
        color: colors.gray,
        marginBottom: 16,
    },
    label: {
        fontSize: 13,
        color: colors.text,
        marginBottom: 4,
        marginTop: 10,
    },
    hint: {
        fontSize: 12,
        color: colors.gray,
        marginTop: 6,
    },
    input: {
        borderWidth: 1,
        borderColor: colors.inputBorder,
        borderRadius: 10,
        paddingHorizontal: 10,
        paddingVertical: 8,
        fontSize: 14,
        color: colors.text,
    },
    primaryButton: {
        marginTop: 24,
        backgroundColor: colors.primary,
        paddingVertical: 12,
        borderRadius: 999,
        alignItems: 'center',
        justifyContent: 'center',
    },
    primaryButtonText: {
        color: colors.buttonText,
        fontWeight: '700',
        fontSize: 15,
    },
});
