import test from 'node:test';
import assert from 'node:assert/strict';
import { describeApiError } from '../apiError';

test('prefers the server\'s own message', () => {
    const e = { response: { status: 503, data: { error: "AI isn't configured on this server." } } };
    assert.equal(describeApiError(e), "AI isn't configured on this server.");
});

test('explains a timeout instead of a generic error', () => {
    assert.match(describeApiError({ code: 'ECONNABORTED', message: 'timeout of 15000ms exceeded' }), /too long/i);
});

test('explains an unreachable server', () => {
    assert.match(describeApiError({ request: {}, message: 'Network Error' }), /can't reach/i);
});

test('403 without a message says access is missing', () => {
    assert.match(describeApiError({ response: { status: 403, data: {} } }), /access/i);
});

test('falls back to the caller\'s text', () => {
    assert.equal(describeApiError(new Error('x'), 'Please try again.'), 'Please try again.');
});
