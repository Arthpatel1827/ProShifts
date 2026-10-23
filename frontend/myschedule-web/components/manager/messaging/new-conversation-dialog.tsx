"use client";

import { useMemo, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Textarea } from "@/components/ui/form";
import { Avatar } from "@/components/ui/primitives";
import { useManager } from "@/components/manager/manager-context";
import { createGroup, openDirectMessage } from "@/lib/api/messaging";
import { listStaff } from "@/lib/api/team";
import { useQuery } from "@/lib/hooks/use-query";
import type { Channel } from "@/lib/types";

type Props = {
    mode: "dm" | "group" | null;
    onClose: () => void;
    onCreated: (channel: Channel) => void;
};

export function NewConversationDialog({ mode, onClose, onCreated }: Props) {
    const { location, user } = useManager();
    const staff = useQuery(mode && location ? ["staff", location.id] : null, () => listStaff(location!.id));
    const [search, setSearch] = useState("");
    const [selected, setSelected] = useState<number[]>([]);
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [broadcast, setBroadcast] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const [prevMode, setPrevMode] = useState(mode);
    if (mode !== prevMode) {
        setPrevMode(mode);
        if (mode) {
            setSearch("");
            setSelected([]);
            setName("");
            setDescription("");
            setBroadcast(false);
            setError(null);
        }
    }

    const people = useMemo(() => {
        const q = search.trim().toLowerCase();
        return (staff.data ?? [])
            .filter((s) => s.user_id !== user?.user_id)
            .filter((s) => !q || (s.display_name || s.username).toLowerCase().includes(q) || s.role?.toLowerCase().includes(q))
            .sort((a, b) => (a.display_name || a.username).localeCompare(b.display_name || b.username));
    }, [staff.data, search, user]);

    async function startDm(userId: number) {
        setBusy(true);
        setError(null);
        try {
            onCreated(await openDirectMessage(userId));
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Couldn't open the conversation.");
        } finally {
            setBusy(false);
        }
    }

    async function submitGroup(e: React.FormEvent) {
        e.preventDefault();
        if (!name.trim()) return setError("Give the group a name.");
        if (!selected.length) return setError("Add at least one person.");
        setBusy(true);
        setError(null);
        try {
            onCreated(
                await createGroup({
                    name: name.trim(),
                    member_ids: selected,
                    description: description.trim() || undefined,
                    is_broadcast: broadcast,
                })
            );
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Couldn't create the group.");
        } finally {
            setBusy(false);
        }
    }

    const toggle = (id: number) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

    const list = (
        <div className="max-h-64 overflow-y-auto rounded-md border border-border">
            {staff.loading ? (
                <p className="p-4 text-sm text-muted-foreground">Loading team…</p>
            ) : staff.error ? (
                <p className="p-4 text-sm text-destructive">{staff.error.message}</p>
            ) : !people.length ? (
                <p className="p-4 text-sm text-muted-foreground">No one found.</p>
            ) : (
                <ul className="divide-y divide-border">
                    {people.map((p) => {
                        const label = p.display_name || p.username;
                        return (
                            <li key={p.user_id}>
                                {mode === "dm" ? (
                                    <button
                                        onClick={() => startDm(p.user_id)}
                                        disabled={busy}
                                        className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted/50"
                                    >
                                        <Avatar name={label} className="size-7" />
                                        <span className="flex-1">{label}</span>
                                        <span className="text-xs text-muted-foreground">{p.role}</span>
                                    </button>
                                ) : (
                                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-muted/50">
                                        <input
                                            type="checkbox"
                                            checked={selected.includes(p.user_id)}
                                            onChange={() => toggle(p.user_id)}
                                            className="size-4 accent-primary"
                                        />
                                        <span className="flex-1">{label}</span>
                                        <span className="text-xs text-muted-foreground">{p.role}</span>
                                    </label>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );

    return (
        <Dialog
            open={mode !== null}
            onOpenChange={(o) => !o && !busy && onClose()}
            title={mode === "group" ? "New group" : "New direct message"}
            footer={
                mode === "group" && (
                    <>
                        <Button variant="ghost" onClick={onClose} disabled={busy}>
                            Cancel
                        </Button>
                        <Button type="submit" form="group-form" disabled={busy}>
                            {busy ? "Creating…" : `Create group${selected.length ? ` (${selected.length + 1})` : ""}`}
                        </Button>
                    </>
                )
            }
        >
            <div className="space-y-4">
                <FormError message={error} />
                {mode === "group" ? (
                    <form id="group-form" onSubmit={submitGroup} className="space-y-4">
                        <Field label="Group name" htmlFor="group-name">
                            <Input id="group-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} autoFocus />
                        </Field>
                        <Field label="Description (optional)" htmlFor="group-desc">
                            <Textarea id="group-desc" value={description} maxLength={200} onChange={(e) => setDescription(e.target.value)} className="min-h-14" />
                        </Field>
                        <label className="flex items-center gap-2 text-sm">
                            <input type="checkbox" checked={broadcast} onChange={(e) => setBroadcast(e.target.checked)} className="size-4 accent-primary" />
                            Announcements only (members can read but not post)
                        </label>
                        <div className="space-y-2">
                            <Input type="search" placeholder="Search people" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search people" />
                            {list}
                        </div>
                    </form>
                ) : (
                    <div className="space-y-2">
                        <Input type="search" placeholder="Search people" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search people" autoFocus />
                        {list}
                    </div>
                )}
            </div>
        </Dialog>
    );
}
