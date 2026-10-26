"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Coffee, Delete, Loader2, LogOut, Lock, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type Session = { device: string; location: string | null; company: string | null; timezone: string };
type Result =
    | { kind: "choose"; name: string; pin: string }
    | { kind: "done"; title: string; detail?: string; tone: "success" | "info" }
    | { kind: "error"; message: string; locked?: boolean };

const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
const RESET_MS = { done: 5000, error: 3500, choose: 15000 };

/**
 * ProShifts Punch In: a shared tablet at the store. Staff type their personal 4-digit
 * PIN; nothing about anyone is shown except their first name and their own shift.
 * The PIN is kept in memory only for the "break or clock out?" choice, then cleared.
 */
export default function KioskScreen() {
    const [session, setSession] = useState<Session | null>(null);
    const [setupError, setSetupError] = useState<string | null>(null);
    const [pin, setPin] = useState("");
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState<Result | null>(null);
    const [now, setNow] = useState<Date | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    useEffect(() => {
        fetch("/api/kiosk/session", { cache: "no-store" })
            .then(async (r) => (r.ok ? setSession(await r.json()) : setSetupError((await r.json().catch(() => ({}))).error ?? "This tablet isn't set up.")))
            .catch(() => setSetupError("Can't reach ProShifts right now."));
        const first = setTimeout(() => setNow(new Date()), 0);
        const t = setInterval(() => setNow(new Date()), 15_000);
        return () => {
            clearTimeout(first);
            clearInterval(t);
        };
    }, []);

    const reset = useCallback(() => {
        clearTimeout(timer.current);
        setResult(null);
        setPin("");
    }, []);

    const show = useCallback((r: Result) => {
        clearTimeout(timer.current);
        setResult(r);
        setPin("");
        timer.current = setTimeout(reset, RESET_MS[r.kind]);
    }, [reset]);

    const send = useCallback(async (code: string, action = "auto") => {
        setBusy(true);
        try {
            const res = await fetch("/api/kiosk/punch", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ pin: code, action }),
            });
            const body = await res.json().catch(() => ({}));
            if (res.status === 429) return show({ kind: "error", message: "Too many tries. Wait a minute and try again." });
            if (res.status === 423) return show({ kind: "error", message: body.error ?? "Locked for a few minutes.", locked: true });
            if (!res.ok) return show({ kind: "error", message: body.error ?? "Something went wrong." });
            const shift = body.shift ? `Shift: ${body.shift.start} – ${body.shift.end}` : undefined;
            switch (body.status) {
                case "choose":
                    return show({ kind: "choose", name: body.first_name, pin: code });
                case "clocked_in":
                    return show({ kind: "done", tone: "success", title: `Welcome, ${body.first_name}!`, detail: `Clock-in successful.${shift ? `\n${shift}` : ""}\nHave a great shift!` });
                case "clocked_out":
                    return show({ kind: "done", tone: "success", title: `Bye, ${body.first_name}!`, detail: "Clock-out successful. Thanks for today." });
                case "break_started":
                    return show({ kind: "done", tone: "info", title: `Enjoy your break, ${body.first_name}`, detail: "Punch in again when you're back." });
                case "break_ended":
                    return show({ kind: "done", tone: "success", title: `Welcome back, ${body.first_name}`, detail: "Break ended." });
            }
            show({ kind: "error", message: "Something went wrong." });
        } catch {
            show({ kind: "error", message: "Can't reach ProShifts. Check the tablet's connection." });
        } finally {
            setBusy(false);
        }
    }, [show]);

    const press = useCallback((d: string) => {
        if (busy || result) return;
        setPin((p) => {
            const next = (p + d).slice(0, 4);
            if (next.length === 4) void send(next);
            return next;
        });
    }, [busy, result, send]);

    // A hardware keyboard works too.
    useEffect(() => {
        function onKey(e: KeyboardEvent) {
            if (/^\d$/.test(e.key)) press(e.key);
            else if (e.key === "Backspace") setPin((p) => p.slice(0, -1));
            else if (e.key === "Escape") reset();
        }
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [press, reset]);

    const time = now && session
        ? now.toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: session.timezone })
        : "";

    if (setupError) {
        return (
            <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background p-6 text-center">
                <Lock className="size-10 text-muted-foreground" />
                <h1 className="text-2xl font-semibold">ProShifts Punch In</h1>
                <p className="max-w-sm text-muted-foreground">{setupError} A manager can set it up from Settings → Punch-in tablets.</p>
            </main>
        );
    }

    return (
        <main className="flex min-h-dvh flex-col items-center justify-between bg-gradient-to-b from-primary/10 via-background to-background px-4 py-6 select-none">
            <header className="text-center">
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary">ProShifts</p>
                <h1 className="mt-1 text-3xl font-bold text-foreground">Clock In / Out</h1>
                <p className="mt-1 text-sm text-muted-foreground" aria-live="polite">
                    {session ? `${session.location ?? ""}${time ? ` · ${time}` : ""}` : "Loading…"}
                </p>
            </header>

            <section className="flex w-full max-w-sm flex-1 flex-col items-center justify-center" aria-live="assertive">
                {result?.kind === "done" ? (
                    <div className="space-y-3 text-center" role="status">
                        <CheckCircle2 className={cn("mx-auto size-16", result.tone === "success" ? "text-success" : "text-primary")} />
                        <h2 className="text-3xl font-bold">{result.title}</h2>
                        {result.detail && <p className="whitespace-pre-line text-lg text-muted-foreground">{result.detail}</p>}
                    </div>
                ) : result?.kind === "choose" ? (
                    <div className="w-full space-y-4 text-center">
                        <h2 className="text-2xl font-bold">Hi, {result.name}</h2>
                        <p className="text-muted-foreground">You&apos;re on the clock. What would you like to do?</p>
                        <div className="grid grid-cols-2 gap-3">
                            <button disabled={busy} onClick={() => void send(result.pin, "break_start")}
                                className="flex h-28 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-border bg-card text-lg font-semibold shadow-sm active:scale-[0.98]">
                                <Coffee className="size-7 text-primary" /> Start break
                            </button>
                            <button disabled={busy} onClick={() => void send(result.pin, "clock_out")}
                                className="flex h-28 flex-col items-center justify-center gap-2 rounded-2xl bg-primary text-lg font-semibold text-primary-foreground shadow-sm active:scale-[0.98]">
                                <LogOut className="size-7" /> Clock out
                            </button>
                        </div>
                        <button onClick={reset} className="text-sm text-muted-foreground underline">Cancel</button>
                    </div>
                ) : (
                    <>
                        <p className="text-lg font-medium text-foreground">Enter your PIN</p>
                        <div className="my-5 flex gap-4" aria-label={`${pin.length} of 4 digits entered`}>
                            {[0, 1, 2, 3].map((i) => (
                                <span key={i} className={cn("size-5 rounded-full border-2 border-primary transition-colors", i < pin.length && "bg-primary")} />
                            ))}
                        </div>
                        {result?.kind === "error" ? (
                            <p role="alert" className="mb-3 flex items-center gap-2 text-base font-medium text-destructive">
                                {result.locked ? <Lock className="size-5" /> : <XCircle className="size-5" />} {result.message}
                            </p>
                        ) : busy ? (
                            <Loader2 className="mb-3 size-6 animate-spin text-primary" aria-label="Checking" />
                        ) : (
                            <div className="mb-3 h-6" />
                        )}
                        <div className="grid w-full grid-cols-3 gap-3" role="group" aria-label="PIN pad">
                            {DIGITS.map((d) => (
                                <PadKey key={d} onPress={() => press(d)} disabled={busy || !!result}>{d}</PadKey>
                            ))}
                            <PadKey onPress={reset} disabled={busy} small>Clear</PadKey>
                            <PadKey onPress={() => press("0")} disabled={busy || !!result}>0</PadKey>
                            <PadKey onPress={() => setPin((p) => p.slice(0, -1))} disabled={busy || !!result} small label="Delete last digit">
                                <Delete className="mx-auto size-6" />
                            </PadKey>
                        </div>
                    </>
                )}
            </section>

            <footer className="text-center text-xs text-muted-foreground">
                {session?.company ?? ""} · Your PIN is personal. Don&apos;t share it.
            </footer>
        </main>
    );
}

function PadKey({ children, onPress, disabled, small, label }: { children: React.ReactNode; onPress: () => void; disabled?: boolean; small?: boolean; label?: string }) {
    return (
        <button
            type="button"
            onClick={onPress}
            disabled={disabled}
            aria-label={label}
            className={cn(
                "h-20 rounded-2xl border border-border bg-card font-semibold text-foreground shadow-sm transition-transform active:scale-95 active:bg-primary/10 disabled:opacity-50 sm:h-24",
                small ? "text-base text-muted-foreground" : "text-3xl"
            )}
        >
            {children}
        </button>
    );
}
