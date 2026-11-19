// Drives the real axios instance in src/api/api.ts against a simulated server, with the phone's
// secure storage replaced by an in-memory map.
import test from 'node:test';
import assert from 'node:assert/strict';

const Module = require('module');
const store = new Map<string, string>();
const stubs: Record<string, any> = {
    'expo-secure-store': {
        setItemAsync: async (k: string, v: string) => { store.set(k, v); },
        getItemAsync: async (k: string) => store.get(k) ?? null,
        deleteItemAsync: async (k: string) => { store.delete(k); },
    },
    'expo-local-authentication': {},
    'react-native': { Platform: { OS: 'android' } },
};
const realLoad = Module._load;
Module._load = function (request: string, ...rest: any[]) {
    return request in stubs ? stubs[request] : realLoad.call(this, request, ...rest);
};

process.env.EXPO_PUBLIC_API_URL = 'http://api.test';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const axios = require('axios');
const { api, AuthAPI, AIAPI } = require('../../api/api');
const { onSessionExpired } = require('../sessionEvents');

type Handler = (cfg: any) => { status: number; data?: any };
function server(handler: Handler) {
    const calls: string[] = [];
    const adapter = async (config: any) => {
        const path = String(config.url).replace('http://api.test', '');
        calls.push(`${config.method?.toUpperCase()} ${path}`);
        const { status, data } = handler({ ...config, path });
        const response = { status, data: data ?? {}, statusText: '', headers: {}, config };
        if (status >= 400) throw new axios.AxiosError('Request failed', 'ERR_BAD_REQUEST', config, null, response);
        return response;
    };
    api.defaults.adapter = adapter;
    axios.defaults.adapter = adapter;
    return calls;
}
function reset() {
    store.clear();
    store.set('access_token', 'stale-access'); store.set('refresh_token', 'stale-refresh');
    store.set('auth_token_secure', 'saved-copy'); store.set('auth_user_secure', '{"id":1}');
}

test('dead session (tokens from another server): one refresh attempt, then signed out', async () => {
    reset();
    let expired = 0; const off = onSessionExpired(() => { expired++; });
    const calls = server(cfg => cfg.path === '/auth/refresh'
        ? { status: 422, data: { error: 'Invalid token.' } }
        : { status: 422, data: { error: 'Invalid token.' } });

    // the screen fires many requests at once, like the app did at 17:32
    const results = await Promise.allSettled([
        api.get('/admin/locations'), api.get('/shifts/mine'), api.get('/time-entries/active'),
        api.get('/notifications/'), api.get('/time-entries/team-status'),
    ]);
    off();
    assert.ok(results.every(r => r.status === 'rejected'));
    assert.equal(calls.filter(c => c === 'POST /auth/refresh').length, 1, 'refreshes are single-flight');
    assert.equal(store.has('access_token') || store.has('refresh_token'), false, 'dead tokens cleared');
    assert.equal(store.has('auth_token_secure') || store.has('auth_user_secure'), false, 'biometric copy cleared');
    assert.ok(expired >= 1, 'the app is told to sign out');
});

test('expired access token + good refresh token: refreshed once, request replayed, no sign-out', async () => {
    reset();
    let expired = 0; const off = onSessionExpired(() => { expired++; });
    const calls = server(cfg => {
        if (cfg.path === '/auth/refresh') return { status: 200, data: { access_token: 'fresh-access' } };
        return cfg.headers.Authorization === 'Bearer fresh-access'
            ? { status: 200, data: { ok: true } }
            : { status: 401, data: { error: 'Token has expired. Please log in again.' } };
    });
    const [a, b] = await Promise.all([api.get('/admin/locations'), api.get('/shifts/mine')]);
    off();
    assert.equal(a.data.ok && b.data.ok, true);
    assert.equal(calls.filter(c => c === 'POST /auth/refresh').length, 1);
    assert.equal(store.get('access_token'), 'fresh-access');
    assert.equal(expired, 0);
});

test('wrong password is just an answer: no refresh, no sign-out, tokens untouched', async () => {
    reset();
    let expired = 0; const off = onSessionExpired(() => { expired++; });
    const calls = server(() => ({ status: 401, data: { error: 'Invalid credentials, Try again with correct details!' } }));
    await assert.rejects(AuthAPI.login('a@b.c', 'nope'), (e: any) => e.response.status === 401);
    off();
    assert.deepEqual(calls, ['POST /auth/login']);
    assert.equal(store.get('access_token'), 'stale-access');
    assert.equal(expired, 0);
});

test('a server that is down or slow is not a dead session', async () => {
    reset();
    let expired = 0; const off = onSessionExpired(() => { expired++; });
    api.defaults.adapter = async (config: any) => { throw new axios.AxiosError('timeout', 'ECONNABORTED', config); };
    await assert.rejects(api.get('/admin/locations'));
    off();
    assert.equal(store.get('access_token'), 'stale-access');
    assert.equal(expired, 0);
});

test('AI calls are allowed longer than the 15 s default', async () => {
    reset();
    let seen: Record<string, number> = {};
    api.defaults.adapter = async (config: any) => {
        seen[config.url] = config.timeout;
        return { status: 200, data: {}, statusText: '', headers: {}, config };
    };
    await AIAPI.chat({ message: 'hi', location_id: 1 });
    await api.get('/admin/locations');
    assert.ok(seen['/ai/chat'] >= 90000);
    assert.equal(seen['/admin/locations'], 15000);
});
