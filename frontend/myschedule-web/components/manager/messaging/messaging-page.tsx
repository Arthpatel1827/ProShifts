"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, MessageSquarePlus, MessagesSquare, Plus, ShieldCheck } from "lucide-react";
import { useManager } from "@/components/manager/manager-context";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, ErrorState, Skeleton } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { listChannels, listLocationGroups, setupChannels } from "@/lib/api/messaging";
import { Dialog } from "@/components/ui/dialog";
import { MembersPanel } from "./members-panel";
import { useQuery } from "@/lib/hooks/use-query";
import { useChannelRooms, useSocketEvent } from "@/lib/hooks/use-socket";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Channel, Message } from "@/lib/types";
import { Conversation } from "./conversation";
import { NewConversationDialog } from "./new-conversation-dialog";
import { ChannelIcon } from "./channel-icon";

const GROUPS: { key: string; label: string; types: string[] }[] = [
    { key: "channels", label: "Channels", types: ["general", "role", "broadcast"] },
    { key: "groups", label: "Groups", types: ["group"] },
    { key: "shift", label: "Shift threads", types: ["shift"] },
    { key: "direct", label: "Direct messages", types: ["direct"] },
];

export default function MessagingPage() {
    const { location, user, canApprove } = useManager();
    const [manageOpen, setManageOpen] = useState(false);
    const toast = useToast();
    const channels = useQuery(["channels"], listChannels);
    // Deep link: /manager/messaging?channel=123 (used by Team → Message).
    const searchParams = useSearchParams();
    const [activeId, setActiveId] = useState<number | null>(() => Number(searchParams.get("channel")) || null);
    const [newOpen, setNewOpen] = useState<"dm" | "group" | null>(null);
    const [settingUp, setSettingUp] = useState(false);

    const list = useMemo(() => channels.data ?? [], [channels.data]);
    useChannelRooms(list.map((c) => c.channel_id));

    // Keep the sidebar previews and unread counts live.
    useSocketEvent<Message>("message:new", (msg) => {
        channels.setData((prev = []) => {
            if (!prev.some((c) => c.channel_id === msg.channel_id)) {
                void channels.refetch(); // a channel we haven't loaded yet (e.g. new DM)
                return prev;
            }
            return prev.map((c) =>
                c.channel_id === msg.channel_id
                    ? {
                          ...c,
                          last_message: msg,
                          unread:
                              msg.channel_id === activeId || msg.sender_id === user?.user_id ? c.unread : c.unread + 1,
                      }
                    : c
            );
        });
    });

    const active = list.find((c) => c.channel_id === activeId) ?? null;

    function select(channel: Channel) {
        setActiveId(channel.channel_id);
        channels.setData((prev = []) => prev.map((c) => (c.channel_id === channel.channel_id ? { ...c, unread: 0 } : c)));
        window.history.replaceState(null, "", `?channel=${channel.channel_id}`);
    }

    async function handleSetup() {
        if (!location) return;
        setSettingUp(true);
        try {
            await setupChannels(location.id);
            await channels.refetch();
            toast.success("Team channels created", "#general and one channel per role.");
        } catch (err) {
            toast.error("Couldn't create channels", err instanceof Error ? err.message : undefined);
        } finally {
            setSettingUp(false);
        }
    }

    function onCreated(channel: Channel) {
        channels.setData((prev = []) =>
            prev.some((c) => c.channel_id === channel.channel_id) ? prev : [channel, ...prev]
        );
        select(channel);
    }

    const sorted = [...list].sort((a, b) =>
        (b.last_message?.created_at ?? "").localeCompare(a.last_message?.created_at ?? "") // same UTC basis, so string order works
    );
    const hasGeneral = list.some((c) => c.channel_type === "general");

    return (
        <Card className="flex h-[calc(100dvh-8rem)] min-h-[480px] overflow-hidden">
            {/* Channel list — hidden on mobile while a conversation is open */}
            <aside
                className={cn(
                    "flex w-full flex-col border-r border-border md:w-72 md:shrink-0",
                    active && "hidden md:flex"
                )}
            >
                <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
                    <h2 className="text-sm font-semibold">Conversations</h2>
                    <div className="flex gap-1">
                        <Button variant="ghost" size="icon-sm" onClick={() => setNewOpen("dm")} aria-label="New direct message">
                            <MessageSquarePlus />
                        </Button>
                        {canApprove && location && (
                            <Button variant="ghost" size="icon-sm" onClick={() => setManageOpen(true)} aria-label="Manage groups" title="Manage group members and admins">
                                <ShieldCheck />
                            </Button>
                        )}
                        <Button variant="ghost" size="icon-sm" onClick={() => setNewOpen("group")} aria-label="New group">
                            <Plus />
                        </Button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto">
                    {channels.error ? (
                        <div className="p-3">
                            <ErrorState message={channels.error.message} onRetry={channels.refetch} />
                        </div>
                    ) : channels.loading ? (
                        <div className="space-y-2 p-3">
                            {Array.from({ length: 6 }, (_, i) => (
                                <Skeleton key={i} className="h-12" />
                            ))}
                        </div>
                    ) : (
                        <>
                            {!hasGeneral && (
                                <div className="m-3 rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
                                    <p className="mb-2">Set up #general and a channel for each role at {location?.name}.</p>
                                    <Button size="sm" onClick={handleSetup} disabled={settingUp}>
                                        {settingUp ? "Creating…" : "Create team channels"}
                                    </Button>
                                </div>
                            )}
                            {GROUPS.map((g) => {
                                const items = sorted.filter((c) => g.types.includes(c.channel_type));
                                if (!items.length) return null;
                                return (
                                    <div key={g.key} className="py-2">
                                        <p className="px-4 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                            {g.label}
                                        </p>
                                        <ul>
                                            {items.map((c) => (
                                                <ChannelRow key={c.channel_id} channel={c} active={c.channel_id === activeId} onSelect={select} />
                                            ))}
                                        </ul>
                                    </div>
                                );
                            })}
                        </>
                    )}
                </div>
            </aside>

            <section className={cn("min-w-0 flex-1 flex-col", active ? "flex" : "hidden md:flex")}>
                {active ? (
                    <>
                        <button
                            onClick={() => setActiveId(null)}
                            className="flex items-center gap-1 border-b border-border px-4 py-2 text-sm text-muted-foreground md:hidden"
                        >
                            <ArrowLeft className="size-4" /> All conversations
                        </button>
                        <Conversation key={active.channel_id} channel={active} onChannelsChanged={() => void channels.refetch()} />
                    </>
                ) : (
                    <EmptyState
                        className="flex-1"
                        icon={MessagesSquare}
                        title="Pick a conversation"
                        description="Message your whole team, a role, a group, or one person."
                    />
                )}
            </section>

            {manageOpen && location && (
                <ManageGroupsDialog locationId={location.id} onClose={() => { setManageOpen(false); void channels.refetch(); }} />
            )}
            <NewConversationDialog mode={newOpen} onClose={() => setNewOpen(null)} onCreated={onCreated} />
        </Card>
    );
}

function ChannelRow({ channel: c, active, onSelect }: { channel: Channel; active: boolean; onSelect: (c: Channel) => void }) {
    const preview = c.last_message
        ? `${c.last_message.is_mine ? "You: " : c.channel_type === "direct" ? "" : `${c.last_message.sender_name.split(" ")[0]}: `}${c.last_message.content}`
        : c.description ?? "No messages yet";
    return (
        <li>
            <button
                onClick={() => onSelect(c)}
                aria-current={active ? "true" : undefined}
                className={cn(
                    "flex w-full items-center gap-3 px-4 py-2 text-left transition-colors",
                    active ? "bg-primary/10" : "hover:bg-muted/60"
                )}
            >
                <ChannelIcon type={c.channel_type} className={cn("size-4 shrink-0", active ? "text-primary" : "text-muted-foreground")} />
                <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                        <span className={cn("truncate text-sm", c.unread ? "font-semibold text-foreground" : "text-foreground")}>
                            {c.channel_type === "direct" ? c.name : c.name.replace(/^#/, "")}
                        </span>
                        {c.last_message && (
                            <span className="shrink-0 text-[10px] text-muted-foreground">{formatRelative(c.last_message.created_at)}</span>
                        )}
                    </div>
                    <p className={cn("truncate text-xs", c.unread ? "text-foreground" : "text-muted-foreground")}>{preview}</p>
                </div>
                {c.unread > 0 && (
                    <span className="min-w-5 rounded-full bg-primary px-1.5 text-center text-[11px] font-semibold text-primary-foreground tabular-nums">
                        {c.unread > 99 ? "99+" : c.unread}
                    </span>
                )}
            </button>
        </li>
    );
}


/** Managers: every group at the location, including ones they aren't in. */
function ManageGroupsDialog({ locationId, onClose }: { locationId: number; onClose: () => void }) {
    const groups = useQuery(["location-groups", locationId], () => listLocationGroups(locationId));
    const [pick, setPick] = useState<number | null>(null);
    const chosen = groups.data?.find((g) => g.channel_id === pick) ?? null;
    return (
        <Dialog open onOpenChange={(o) => !o && onClose()} title="Manage groups"
            description="Private groups and role channels: choose who's in them and who can manage them. #general is automatic.">
            {groups.loading ? <Skeleton className="h-24" /> : groups.error ? <ErrorState message={groups.error.message} /> : (
                <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
                    <ul className="space-y-1" role="listbox" aria-label="Groups">
                        {(groups.data ?? []).map((g) => (
                            <li key={g.channel_id}>
                                <button role="option" aria-selected={pick === g.channel_id} onClick={() => setPick(g.channel_id)}
                                    className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                                        pick === g.channel_id ? "bg-primary/10 font-medium text-primary" : "hover:bg-muted")}>
                                    <ChannelIcon type={g.channel_type} className="size-4" />
                                    <span className="flex-1 truncate">{g.name}</span>
                                    <span className="text-xs text-muted-foreground">{g.member_count}</span>
                                </button>
                            </li>
                        ))}
                        {!groups.data?.length && <p className="text-sm text-muted-foreground">No groups yet.</p>}
                    </ul>
                    <div>{chosen ? <MembersPanel key={chosen.channel_id} channel={chosen} onChanged={() => void groups.refetch()} /> :
                        <p className="text-sm text-muted-foreground">Pick a group to manage its members.</p>}</div>
                </div>
            )}
        </Dialog>
    );
}
