import test from 'node:test';
import assert from 'node:assert/strict';
import { isSessionRejected, isAuthEndpoint, onSessionExpired, emitSessionExpired } from '../sessionEvents';

test('401 and 422 "Invalid token." are rejected sessions; other 422s and 403s are not', () => {
    assert.equal(isSessionRejected({ response: { status: 401 } }), true);
    assert.equal(isSessionRejected({ response: { status: 422, data: { error: 'Invalid token.' } } }), true);
    assert.equal(isSessionRejected({ response: { status: 422, data: { error: 'Shift overlaps another shift' } } }), false);
    assert.equal(isSessionRejected({ response: { status: 403, data: {} } }), false);
    assert.equal(isSessionRejected({ code: 'ECONNABORTED' }), false);   // offline ≠ signed out
    assert.equal(isSessionRejected(undefined), false);
});

test('auth endpoints are not "repaired" by refreshing', () => {
    for (const u of ['/auth/login', '/auth/refresh', '/auth/register', '/auth/forgot-password', '/auth/forgot-password/confirm']) {
        assert.equal(isAuthEndpoint(u), true, u);
    }
    for (const u of ['/auth/me', '/auth/logout', '/admin/locations', '/ai/chat', undefined]) {
        assert.equal(isAuthEndpoint(u as any), false, String(u));
    }
});

test('session-expired listeners fire, unsubscribe, and survive a throwing listener', () => {
    let a = 0, b = 0;
    const offA = onSessionExpired(() => { a++; });
    const offBad = onSessionExpired(() => { throw new Error('boom'); });
    const offB = onSessionExpired(() => { b++; });
    emitSessionExpired();
    assert.deepEqual([a, b], [1, 1]);
    offA(); offBad(); offB();
    emitSessionExpired();
    assert.deepEqual([a, b], [1, 1]);
});
