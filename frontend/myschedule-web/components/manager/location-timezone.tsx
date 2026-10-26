"use client";

import { useMemo, useState } from "react";
import { Globe } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, FormError, Select } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { updateLocationTimezone } from "@/lib/api/locations";
import { useManager } from "./manager-context";

function browserTz(): string {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
        return "UTC";
    }
}

function allZones(current: string): string[] {
    let zones: string[] = [];
    try {
        zones = Intl.supportedValuesOf("timeZone");
    } catch {
        zones = [];
    }
    return [...new Set(["UTC", current, browserTz(), ...zones])].sort();
}

/** Lets an owner/manager set the selected location's timezone. */
export function LocationTimezoneDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
    const { location, timezone, refreshLocations } = useManager();
    const toast = useToast();
    const zones = useMemo(() => allZones(timezone), [timezone]);
    const suggested = timezone === "UTC" ? browserTz() : timezone;
    const [value, setValue] = useState(suggested);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const [wasOpen, setWasOpen] = useState(open);
    if (open !== wasOpen) {
        setWasOpen(open);
        if (open) {
            setValue(suggested);
            setError(null);
        }
    }

    async function save() {
        if (!location) return;
        setSaving(true);
        setError(null);
        try {
            await updateLocationTimezone(location.id, value);
            await refreshLocations();
            toast.success("Timezone saved", `${location.name} now uses ${value}.`);
            onOpenChange(false);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Couldn't save the timezone.");
        } finally {
            setSaving(false);
        }
    }

    return (
        <Dialog
            open={open}
            onOpenChange={(o) => !saving && onOpenChange(o)}
            title="Location timezone"
            description={`Decides what "today" and "this week" mean for ${location?.name ?? "this location"} — the schedule, Today's Team, late clock-ins and analytics.`}
            size="sm"
            footer={
                <>
                    <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
                        Cancel
                    </Button>
                    <Button onClick={save} disabled={saving || value === timezone}>
                        {saving ? "Saving…" : "Save"}
                    </Button>
                </>
            }
        >
            <div className="space-y-3">
                <FormError message={error} />
                <Field label="Timezone" htmlFor="loc-tz" hint={`Your computer is set to ${browserTz()}.`}>
                    <Select id="loc-tz" value={value} onChange={(e) => setValue(e.target.value)}>
                        {zones.map((z) => (
                            <option key={z} value={z}>
                                {z.replace(/_/g, " ")}
                            </option>
                        ))}
                    </Select>
                </Field>
            </div>
        </Dialog>
    );
}

/**
 * Shown while a location still has the default UTC timezone (every location created
 * before timezones could be set) and the viewer is somewhere else.
 */
export function TimezoneNotice() {
    const { location, timezone, canApprove } = useManager();
    const [open, setOpen] = useState(false);
    const [dismissed, setDismissed] = useState(false);
    if (!location || timezone !== "UTC" || browserTz() === "UTC" || dismissed) return null;

    return (
        <div
            role="status"
            className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm"
        >
            <Globe className="size-4 shrink-0 text-warning" />
            <p className="min-w-0 flex-1 text-foreground">
                <span className="font-medium">{location.name}</span> is set to UTC, so &ldquo;today&rdquo; and shift times
                follow UTC rather than local time.
                {!canApprove && " Ask an owner or manager to set its timezone."}
            </p>
            {canApprove && (
                <Button size="sm" onClick={() => setOpen(true)}>
                    Set timezone
                </Button>
            )}
            <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setDismissed(true)}>
                Dismiss
            </button>
            <LocationTimezoneDialog open={open} onOpenChange={setOpen} />
        </div>
    );
}
