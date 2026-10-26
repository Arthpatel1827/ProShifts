"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Crosshair, KeyRound, Loader2, Lock, MapPin, ShieldCheck, Smartphone, Tablet, Trash2, UserCog } from "lucide-react";
import { useManager } from "@/components/manager/manager-context";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Field, FormError, Input } from "@/components/ui/form";
import { Card, CardHeader, ErrorState, Skeleton } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { updateLocationCoords } from "@/lib/api/locations";
import { generatePin, getClockSettings, updateClockSettings } from "@/lib/api/settings";
import { useQuery } from "@/lib/hooks/use-query";
import { listKioskDevices, removeKioskDevice, setUpThisDeviceAsKiosk } from "@/lib/api/kiosk";
import { formatDate, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ClockInMethod, ClockSettings } from "@/lib/types";

// The backend accepts exactly these values (same choices as the mobile app).
const RADII = [50, 100, 200, 500];
const BREAK_MINUTES = [15, 20, 30, 45, 60];
const MAX_BREAKS: (number | null)[] = [null, 1, 2, 3];

const METHODS: { value: ClockInMethod; label: string; description: string; icon: typeof MapPin }[] = [
    { value: "gps", label: "GPS", description: "Staff clock in on their phone when they're within range of the store.", icon: MapPin },
    { value: "qr_pin", label: "Daily PIN", description: "Staff enter today's 4-digit PIN, shared at the store.", icon: KeyRound },
    { value: "kiosk_pin", label: "Tablet + personal PIN", description: "Staff punch in on the store's tablet with their own 4-digit PIN. Phones can't clock in.", icon: Tablet },
    { value: "manager_only", label: "Manager only", description: "Staff can't clock themselves in; a manager does it for them.", icon: UserCog },
];

type Draft = Omit<ClockSettings, "pin_expires_at">;

export default function SettingsPage() {
    const { location, canApprove, timezone: tz, refreshLocations } = useManager();
    const toast = useToast();
    const q = useQuery(["clock-settings"], getClockSettings);
    const [draft, setDraft] = useState<Draft | null>(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Seed the form from the server whenever fresh settings arrive.
    const [seeded, setSeeded] = useState(q.data);
    if (q.data !== seeded) {
        setSeeded(q.data);
        if (q.data) {
            const { pin_expires_at: _ignored, ...rest } = q.data;
            void _ignored;
            setDraft(rest);
        }
    }

    const s = q.data;
    const dirty =
        !!draft &&
        !!s &&
        (draft.clock_in_method !== s.clock_in_method ||
            draft.gps_radius_meters !== s.gps_radius_meters ||
            draft.break_duration_mins !== s.break_duration_mins ||
            draft.max_breaks_per_shift !== s.max_breaks_per_shift ||
            draft.paid_break !== s.paid_break);
    const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));

    async function save() {
        if (!draft) return;
        setSaving(true);
        setError(null);
        try {
            const updated = await updateClockSettings({
                ...draft,
                // The API uses 0 for "unlimited".
                max_breaks_per_shift: draft.max_breaks_per_shift ?? 0,
            });
            q.setData(updated);
            toast.success("Settings saved", "They apply to every location in your company.");
        } catch (err) {
            setError(err instanceof Error ? err.message : "Couldn't save settings.");
        } finally {
            setSaving(false);
        }
    }

    if (q.error) return <ErrorState message={q.error.message} onRetry={q.refetch} />;
    if (!draft || !s) {
        return (
            <div className="space-y-4">
                <Skeleton className="h-48" />
                <Skeleton className="h-40" />
            </div>
        );
    }

    const readOnly = !canApprove;

    return (
        <div className="mx-auto max-w-3xl space-y-6 pb-24">
            <div>
                <h2 className="text-xl font-semibold text-foreground">Clock-in & breaks</h2>
                <p className="text-sm text-muted-foreground">These rules apply to every location in your company and to the mobile app.</p>
            </div>

            {readOnly && (
                <p className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
                    <Lock className="size-4" /> Only owners and managers can change these settings.
                </p>
            )}
            <FormError message={error} />

            <Card>
                <CardHeader title="How staff clock in" />
                <div className="grid gap-3 px-5 pb-5 sm:grid-cols-2 xl:grid-cols-4" role="radiogroup" aria-label="Clock-in method">
                    {METHODS.map((m) => {
                        const on = draft.clock_in_method === m.value;
                        const Icon = m.icon;
                        return (
                            <button
                                key={m.value}
                                type="button"
                                role="radio"
                                aria-checked={on}
                                disabled={readOnly}
                                onClick={() => set("clock_in_method", m.value)}
                                className={cn(
                                    "relative rounded-lg border p-4 text-left transition-colors disabled:cursor-not-allowed",
                                    on ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border enabled:hover:bg-muted/50"
                                )}
                            >
                                {on && <Check className="absolute right-3 top-3 size-4 text-primary" />}
                                <Icon className={cn("size-5", on ? "text-primary" : "text-muted-foreground")} />
                                <p className="mt-2 text-sm font-semibold text-foreground">{m.label}</p>
                                <p className="mt-0.5 text-xs text-muted-foreground">{m.description}</p>
                            </button>
                        );
                    })}
                </div>
            </Card>

            {draft.clock_in_method === "gps" && (
                <Card>
                    <CardHeader title="GPS range" description="How close to the store staff must be to clock in." />
                    <div className="space-y-5 px-5 pb-5">
                        <Chips
                            label="Radius"
                            options={RADII.map((r) => ({ value: r, label: `${r} m` }))}
                            value={draft.gps_radius_meters}
                            onChange={(v) => set("gps_radius_meters", v)}
                            disabled={readOnly}
                        />
                        {location && <StoreLocation key={location.id} readOnly={readOnly} onSaved={refreshLocations} />}
                    </div>
                </Card>
            )}

            {draft.clock_in_method === "qr_pin" && <PinCard expiresAt={s.pin_expires_at} tz={tz} readOnly={readOnly} onGenerated={q.refetch} savedMethod={s.clock_in_method} />}

            {draft.clock_in_method !== "manager_only" && location && (
                <TabletsCard key={location.id} locationId={location.id} locationName={location.name} readOnly={readOnly} required={draft.clock_in_method === "kiosk_pin"} />
            )}

            {draft.clock_in_method === "manager_only" && (
                <Card>
                    <div className="flex items-start gap-3 px-5 py-4 text-sm">
                        <Smartphone className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                        <p className="text-muted-foreground">
                            Managers clock staff in and out from <span className="font-medium text-foreground">Clock Mgmt</span> in the ProShifts mobile app.
                        </p>
                    </div>
                </Card>
            )}

            <Card>
                <CardHeader title="Breaks" />
                <div className="space-y-5 px-5 pb-5">
                    <Chips
                        label="Break length"
                        options={BREAK_MINUTES.map((m) => ({ value: m, label: `${m} min` }))}
                        value={draft.break_duration_mins}
                        onChange={(v) => set("break_duration_mins", v)}
                        disabled={readOnly}
                    />
                    <Chips
                        label="Breaks per shift"
                        options={MAX_BREAKS.map((n) => ({ value: n, label: n === null ? "Unlimited" : String(n) }))}
                        value={draft.max_breaks_per_shift}
                        onChange={(v) => set("max_breaks_per_shift", v)}
                        disabled={readOnly}
                    />
                    <label className="flex items-center gap-2 text-sm">
                        <input
                            type="checkbox"
                            checked={draft.paid_break}
                            disabled={readOnly}
                            onChange={(e) => set("paid_break", e.target.checked)}
                            className="size-4 accent-primary"
                        />
                        Breaks are paid
                    </label>
                </div>
            </Card>

            {!readOnly && (
                <div className="sticky bottom-4 flex items-center justify-end gap-3 rounded-xl border border-border bg-card/95 px-5 py-3 shadow-lg backdrop-blur">
                    <span className="mr-auto text-sm text-muted-foreground">{dirty ? "You have unsaved changes." : "All changes saved."}</span>
                    <Button variant="ghost" disabled={!dirty || saving} onClick={() => setSeeded(undefined)}>
                        Discard
                    </Button>
                    <Button onClick={save} disabled={!dirty || saving}>
                        {saving ? <Loader2 className="animate-spin" /> : <Check />} Save settings
                    </Button>
                </div>
            )}
        </div>
    );
}

function Chips<T extends number | null>({
    label,
    options,
    value,
    onChange,
    disabled,
}: {
    label: string;
    options: { value: T; label: string }[];
    value: T;
    onChange: (v: T) => void;
    disabled?: boolean;
}) {
    return (
        <div>
            <p className="mb-1.5 text-sm font-medium text-foreground">{label}</p>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={label}>
                {options.map((o) => {
                    const on = o.value === value;
                    return (
                        <button
                            key={String(o.value)}
                            type="button"
                            role="radio"
                            aria-checked={on}
                            disabled={disabled}
                            onClick={() => onChange(o.value)}
                            className={cn(
                                "rounded-md border px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed",
                                on ? "border-primary bg-primary/10 font-semibold text-primary" : "border-border text-foreground enabled:hover:bg-muted"
                            )}
                        >
                            {o.label}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

function StoreLocation({ readOnly, onSaved }: { readOnly: boolean; onSaved: () => Promise<void> }) {
    const { location } = useManager();
    const toast = useToast();
    const [lat, setLat] = useState(location?.loc_lat != null ? String(location.loc_lat) : "");
    const [lng, setLng] = useState(location?.loc_lng != null ? String(location.loc_lng) : "");
    const [busy, setBusy] = useState<"locate" | "save" | null>(null);
    const [error, setError] = useState<string | null>(null);
    if (!location) return null;
    const configured = location.loc_lat != null && location.loc_lng != null;

    function useMyLocation() {
        if (!navigator.geolocation) return setError("This browser can't share its location. Enter the coordinates instead.");
        setBusy("locate");
        setError(null);
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                setLat(pos.coords.latitude.toFixed(6));
                setLng(pos.coords.longitude.toFixed(6));
                setBusy(null);
            },
            () => {
                setError("Couldn't get your location. Allow location access, or enter the coordinates.");
                setBusy(null);
            },
            { enableHighAccuracy: true, timeout: 10000 }
        );
    }

    async function save() {
        const la = Number(lat), lo = Number(lng);
        if (lat.trim() === "" || lng.trim() === "" || !Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) {
            return setError("Enter a latitude between -90 and 90 and a longitude between -180 and 180.");
        }
        setBusy("save");
        setError(null);
        try {
            await updateLocationCoords(location!.id, la, lo);
            await onSaved();
            toast.success("Store location saved", `${location!.name} now uses these coordinates for GPS clock-in.`);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Couldn't save the location.");
        } finally {
            setBusy(null);
        }
    }

    return (
        <div className="space-y-3 border-t border-border pt-4">
            <div>
                <p className="text-sm font-medium text-foreground">Store location · {location.name}</p>
                <p className="text-xs text-muted-foreground">GPS clock-in measures distance from this point. Set it while you&apos;re at the store for accuracy.</p>
            </div>
            {!configured && (
                <p role="alert" className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-foreground">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                    No coordinates yet, so GPS isn&apos;t checked here: staff can clock in from anywhere until you save the store&apos;s location.
                </p>
            )}
            <FormError message={error} />
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
                <Field label="Latitude" htmlFor="loc-lat">
                    <Input id="loc-lat" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} disabled={readOnly} placeholder="43.6532" />
                </Field>
                <Field label="Longitude" htmlFor="loc-lng">
                    <Input id="loc-lng" inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} disabled={readOnly} placeholder="-79.3832" />
                </Field>
                <Button variant="outline" size="lg" onClick={useMyLocation} disabled={readOnly || !!busy}>
                    {busy === "locate" ? <Loader2 className="animate-spin" /> : <Crosshair />} Use my location
                </Button>
                <Button size="lg" onClick={save} disabled={readOnly || !!busy}>
                    {busy === "save" ? <Loader2 className="animate-spin" /> : <Check />} Save location
                </Button>
            </div>
        </div>
    );
}

function PinCard({
    expiresAt,
    tz,
    readOnly,
    onGenerated,
    savedMethod,
}: {
    expiresAt: string | null;
    tz: string;
    readOnly: boolean;
    onGenerated: () => Promise<void>;
    savedMethod: ClockInMethod;
}) {
    const toast = useToast();
    const [pin, setPin] = useState<string | null>(null);
    const [confirm, setConfirm] = useState(false);
    const [busy, setBusy] = useState(false);

    async function generate() {
        setBusy(true);
        try {
            setPin(await generatePin());
            setConfirm(false);
            await onGenerated();
        } catch (err) {
            toast.error("Couldn't generate a PIN", err instanceof Error ? err.message : undefined);
        } finally {
            setBusy(false);
        }
    }

    return (
        <Card>
            <CardHeader title="Today's PIN" description="Valid for 24 hours. Generating a new one replaces the old one immediately." />
            <div className="space-y-4 px-5 pb-5">
                {savedMethod !== "qr_pin" && (
                    <p className="flex items-start gap-2 text-xs text-muted-foreground">
                        <AlertTriangle className="mt-px size-3.5 shrink-0 text-warning" /> Save settings to switch staff to PIN clock-in.
                    </p>
                )}
                {pin ? (
                    <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-4 text-center">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Today&apos;s PIN</p>
                        <p className="mt-1 font-mono text-4xl font-bold tracking-[0.4em] text-foreground" data-testid="clock-pin">
                            {pin}
                        </p>
                        <p className="mt-2 text-xs text-muted-foreground">Shown only now. Post it at the store, not in a group chat, so only people on site can use it.</p>
                    </div>
                ) : (
                    <p className="flex items-center gap-2 text-sm text-foreground">
                        <ShieldCheck className={cn("size-4", expiresAt ? "text-success" : "text-muted-foreground")} />
                        {expiresAt
                            ? `A PIN is active until ${formatTime(expiresAt, tz)}, ${formatDate(expiresAt, { weekday: "short", month: "short", day: "numeric" }, tz)}. For security it can't be shown again.`
                            : "No PIN is active. Staff can't clock in until you generate one."}
                    </p>
                )}
                {!readOnly && (
                    <Button variant={expiresAt || pin ? "outline" : "default"} onClick={() => (expiresAt || pin ? setConfirm(true) : void generate())} disabled={busy}>
                        {busy ? <Loader2 className="animate-spin" /> : <KeyRound />} {expiresAt || pin ? "Generate a new PIN" : "Generate today's PIN"}
                    </Button>
                )}
            </div>
            <ConfirmDialog
                open={confirm}
                onOpenChange={setConfirm}
                title="Replace today's PIN?"
                description="The current PIN stops working right away. Anyone who hasn't clocked in yet will need the new one."
                confirmLabel="Generate new PIN"
                pending={busy}
                onConfirm={generate}
            />
        </Card>
    );
}


/** Punch-in tablets at this location. Works with every method except Manager only:
 *  the store's own tablet, set up by a manager, stands in for phone GPS. */
function TabletsCard({ locationId, locationName, readOnly, required }: { locationId: number; locationName: string; readOnly: boolean; required: boolean }) {
    const toast = useToast();
    const router = useRouter();
    const devices = useQuery(readOnly ? null : ["kiosk-devices", locationId], () => listKioskDevices(locationId));
    const [busy, setBusy] = useState(false);
    const [removing, setRemoving] = useState<number | null>(null);

    async function setUpHere() {
        setBusy(true);
        try {
            await setUpThisDeviceAsKiosk(locationId, `${locationName} tablet`);
            router.push("/kiosk");
        } catch (err) {
            toast.error("Couldn't set up this device", err instanceof Error ? err.message : undefined);
            setBusy(false);
        }
    }

    return (
        <Card>
            <CardHeader
                title="Punch-in tablets"
                description={`Staff tap their personal 4-digit PIN on a tablet at ${locationName}. They set the PIN in the ProShifts app (Me → Clock-in PIN); you never see it.`}
            />
            <div className="space-y-3 px-5 pb-5">
                {required && !devices.loading && !devices.data?.length && (
                    <p className="flex items-center gap-2 rounded-md bg-warning/10 px-3 py-2 text-sm text-foreground">
                        <AlertTriangle className="size-4 text-warning" /> No tablet yet: with this method nobody can clock in until you set one up.
                    </p>
                )}
                {readOnly ? (
                    <p className="text-sm text-muted-foreground">Only owners and managers can set up tablets.</p>
                ) : devices.error ? (
                    <ErrorState message={devices.error.message} onRetry={devices.refetch} />
                ) : (
                    <ul className="divide-y divide-border rounded-md border border-border">
                        {(devices.data ?? []).map((d) => (
                            <li key={d.device_id} className="flex items-center gap-3 px-3 py-2 text-sm">
                                <Tablet className="size-4 text-muted-foreground" />
                                <span className="flex-1">{d.name}</span>
                                <span className="text-xs text-muted-foreground">
                                    {d.last_seen_at ? `Last used ${formatDate(`${d.last_seen_at}Z`, { month: "short", day: "numeric" })}` : "Not used yet"}
                                </span>
                                <Button variant="ghost" size="sm" disabled={removing === d.device_id} aria-label={`Remove ${d.name}`}
                                    onClick={async () => {
                                        setRemoving(d.device_id);
                                        try {
                                            await removeKioskDevice(d.device_id);
                                            toast.success("Tablet removed", "It can't punch anyone in any more.");
                                            await devices.refetch();
                                        } catch (err) {
                                            toast.error("Couldn't remove it", err instanceof Error ? err.message : undefined);
                                        } finally {
                                            setRemoving(null);
                                        }
                                    }}>
                                    <Trash2 /> Remove
                                </Button>
                            </li>
                        ))}
                        {!devices.loading && !devices.data?.length && <li className="px-3 py-2 text-sm text-muted-foreground">No tablets set up.</li>}
                    </ul>
                )}
                {!readOnly && (
                    <div className="flex flex-wrap items-center gap-3">
                        <Button onClick={setUpHere} disabled={busy}>
                            <Tablet /> {busy ? "Setting up…" : "Use this device as the punch-in tablet"}
                        </Button>
                        <span className="text-xs text-muted-foreground">Open this page on the store tablet and press the button. You can sign out afterwards; the tablet keeps working.</span>
                    </div>
                )}
            </div>
        </Card>
    );
}
