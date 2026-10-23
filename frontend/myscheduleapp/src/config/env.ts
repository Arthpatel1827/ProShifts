// src/config/env.ts
import { Platform } from 'react-native';

// ─── Your PC's Wi-Fi IP (from ipconfig → Wi-Fi adapter) ──────────────────────
const LOCAL_IP = '192.168.2.15';

// Physical device (Expo Go) → always use LAN IP
// Android emulator           → use 10.0.2.2
// Change IS_EMULATOR to true only if running on Android Studio emulator
const IS_EMULATOR = false;

// EXPO_PUBLIC_API_URL (e.g. in frontend/myscheduleapp/.env) overrides everything below,
// so each developer — and staging/production builds — can point at their own API.
export const API_BASE_URL =
    process.env.EXPO_PUBLIC_API_URL ??
    (Platform.OS === 'android' && IS_EMULATOR
        ? 'http://10.0.2.2:5000'           // Android emulator → host machine
        : `http://${LOCAL_IP}:5000`);      // Physical device (iOS or Android)

export const GRAPHQL_URL = `${API_BASE_URL}/graphql`;
export const WS_URL      = API_BASE_URL.replace('http', 'ws');