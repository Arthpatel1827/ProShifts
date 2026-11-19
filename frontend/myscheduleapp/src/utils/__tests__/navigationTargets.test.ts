import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Screens' `navigation` prop is typed `any`, so TypeScript can't catch a navigate('X') to a
// screen that doesn't exist — it only fails at runtime ("action NAVIGATE ... was not handled
// by any navigator"). That is how the Login screen's "Forgot password?" and "Create one"
// links broke. This keeps every literal navigation target tied to a real screen.
const SRC = path.resolve(__dirname, '../..');

function files(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => {
        const p = path.join(dir, d.name);
        if (d.isDirectory()) return d.name === '__tests__' ? [] : files(p);
        return /\.tsx?$/.test(d.name) ? [p] : [];
    });
}

test('every literal navigation target is a registered screen', () => {
    const all = files(SRC).map(f => ({ f, text: fs.readFileSync(f, 'utf8') }));

    const registered = new Set<string>();
    for (const { text } of all) {
        for (const m of text.matchAll(/\.Screen\s+name=["'](\w+)["']/g)) registered.add(m[1]);
        for (const m of text.matchAll(/\.Screen\s+name=\{["'](\w+)["']\}/g)) registered.add(m[1]);
    }
    assert.ok(registered.size > 10, 'found the registered screens');

    const missing: string[] = [];
    for (const { f, text } of all) {
        for (const m of text.matchAll(/(?:\b(?:navigation|nav|navigationRef)\??\.(?:navigate|push|replace)|\bnavigate)\(\s*["'](\w+)["']/g)) {
            if (!registered.has(m[1])) missing.push(`${path.relative(SRC, f)} → ${m[1]}`);
        }
    }
    assert.deepEqual(missing, []);
});
