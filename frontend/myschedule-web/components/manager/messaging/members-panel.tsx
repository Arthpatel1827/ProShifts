"use client";

import { useState } from "react";
import { Shield, ShieldOff, UserMinus, UserPlus } from "lucide-react";
import { useManager } from "@/components/manager/manager-context";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { Avatar, ErrorState, Skeleton } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { addMember, listMembers, removeMember, setGroupAdmin } from "@/lib/api/messaging";
import { listStaff } from "@/lib/api/team";
import { useQuery } from "@/lib/hooks/use-query";
import type { Channel } from "@/lib/types";

/**
 * Members of a channel. #general is automatic; private groups (groups, role channels,
 * broadcasts) are managed by managers and group admins. The server enforces every rule;
 * these controls only appear for people it would allow.
 */
export function MembersPanel({ channel, onChanged }: { channel: Channel; onChanged?: () => void }) {
    const { user, location } = useManager();
    const toast = useToast();
    const me = user?.user_id;
    const power = channel.can_manage ?? null;
    const members = useQuery(["members", channel.channel_id], () => listMembers(channel.channel_id));
    const staff = useQuery(power && location ? ["staff", location.id] : null, () => listStaff(location!.id));
    const [adding, setAdding] = useState("");
    const [busy, setBusy] = useState<string | null>(null);

    async function run(key: string, fn: () => Promise<void>, ok: string) {
        setBusy(key);
        try {
            await fn();
            toast.success(ok);
            await members.refetch();
            onChanged?.();
        } catch (err) {
            toast.error("That didn't work", err instanceof Error ? err.message : undefined);
        } finally {
            setBusy(null);
        }
    }

    if (members.loading) return <Skeleton className="h-20" />;
    if (members.error) return <ErrorState message={members.error.message} />;
    const list = members.data ?? [];
    const inGroup = new Set(list.map((m) => m.user_id));
    const candidates = (staff.data ?? []).filter((s) => !inGroup.has(s.user_id));

    return (
        <div className="space-y-3">
            {channel.channel_type === "general" && (
                <p className="rounded-md bg-muted px-2.5 py-2 text-xs text-muted-foreground">
                    Everyone working at this location is in #general automatically.
                </p>
            )}
            {power && (
                <div className="flex gap-1.5">
                    <Select aria-label="Add a member" value={adding} onChange={(e) => setAdding(e.target.value)} className="h-8 flex-1 text-xs">
                        <option value="">{candidates.length ? "Add someone…" : "Everyone's already in"}</option>
                        {candidates.map((c) => (
                            <option key={c.user_id} value={c.user_id}>{c.display_name || c.username}{c.role ? ` · ${c.role}` : ""}</option>
                        ))}
                    </Select>
                    <Button size="sm" disabled={!adding || !!busy} aria-label="Add member"
                        onClick={() => run("add", async () => { await addMember(channel.channel_id, Number(adding)); setAdding(""); }, "Member added")}>
                        <UserPlus />
                    </Button>
                </div>
            )}
            <ul className="space-y-1.5">
                {list.map((m) => {
                    const self = m.user_id === me;
                    const canPromote = !!power && !m.is_admin;
                    const canDemote = m.is_admin && (power === "manager" || (self && power === "admin"));
                    const canRemove = channel.channel_type !== "general" && (self || power === "manager" || (power === "admin" && !m.is_admin));
                    return (
                        <li key={m.user_id} className="flex items-center gap-2 text-sm" data-member={m.user_id}>
                            <Avatar name={m.name} initials={m.initials} className="size-7" />
                            <span className="min-w-0 flex-1">
                                <span className="block truncate">{m.name}{self ? " (you)" : ""}</span>
                                {m.role && <span className="block truncate text-[11px] text-muted-foreground">{m.role}</span>}
                            </span>
                            {m.is_admin && <span className="text-[10px] font-semibold uppercase text-primary">Admin</span>}
                            {channel.channel_type !== "general" && channel.channel_type !== "direct" && (
                                <span className="flex">
                                    {canPromote && (
                                        <button className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" disabled={!!busy}
                                            aria-label={`Make ${m.name} a group admin`} title="Make group admin"
                                            onClick={() => run(`p${m.user_id}`, () => setGroupAdmin(channel.channel_id, m.user_id, true), `${m.name} is now a group admin`)}>
                                            <Shield className="size-3.5" />
                                        </button>
                                    )}
                                    {canDemote && (
                                        <button className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" disabled={!!busy}
                                            aria-label={`Remove ${m.name}'s admin role`} title="Remove admin role"
                                            onClick={() => run(`d${m.user_id}`, () => setGroupAdmin(channel.channel_id, m.user_id, false), `${m.name} is no longer an admin`)}>
                                            <ShieldOff className="size-3.5" />
                                        </button>
                                    )}
                                    {canRemove && (
                                        <button className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" disabled={!!busy}
                                            aria-label={self ? "Leave this group" : `Remove ${m.name}`} title={self ? "Leave" : "Remove from group"}
                                            onClick={() => run(`r${m.user_id}`, () => removeMember(channel.channel_id, m.user_id), self ? "You left the group" : `${m.name} removed`)}>
                                            <UserMinus className="size-3.5" />
                                        </button>
                                    )}
                                </span>
                            )}
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
