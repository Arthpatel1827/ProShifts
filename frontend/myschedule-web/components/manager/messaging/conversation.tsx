"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { CheckCheck, CornerUpLeft, Pin, PinOff, Send, SmilePlus, Users, X } from "lucide-react";
import { useManager } from "@/components/manager/manager-context";
import { Button } from "@/components/ui/button";
import { Avatar, ErrorState, Skeleton } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { listMessages, listPinned, markRead, sendMessage, togglePin, toggleReaction } from "@/lib/api/messaging";
import { useQuery } from "@/lib/hooks/use-query";
import { emitTyping, useSocketEvent } from "@/lib/hooks/use-socket";
import { formatDate, formatTime, fromServerUtc, isSameDay } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Channel, Message } from "@/lib/types";
import { ChannelIcon } from "./channel-icon";
import { MembersPanel } from "./members-panel";

const QUICK_REACTIONS = ["👍", "❤️", "😂", "🎉", "👀", "✅"];
const TYPING_IDLE_MS = 2500;

/** Renders @mentions highlighted. The backend notifies by username or role name. */
function renderContent(text: string) {
    const parts = text.split(/(@\w+)/g);
    return parts.map((p, i) =>
        p.startsWith("@") ? (
            <span key={i} className="rounded bg-primary/10 px-0.5 font-medium text-primary">
                {p}
            </span>
        ) : (
            <Fragment key={i}>{p}</Fragment>
        )
    );
}

export function Conversation({ channel, onChannelsChanged }: { channel: Channel; onChannelsChanged?: () => void }) {
    const { user } = useManager();
    const toast = useToast();
    const me = user?.user_id;
    const myName = user?.display_name || user?.username || "Someone";

    const [messages, setMessages] = useState<Message[]>([]);
    const [hasMore, setHasMore] = useState(false);
    const [loading, setLoading] = useState(true);
    const [loadingOlder, setLoadingOlder] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [draft, setDraft] = useState("");
    const [replyTo, setReplyTo] = useState<Message | null>(null);
    const [sending, setSending] = useState(false);
    const [panel, setPanel] = useState<"pinned" | "members" | null>(null);
    const [typing, setTyping] = useState<string[]>([]);
    const scrollRef = useRef<HTMLDivElement>(null);
    const stickToBottom = useRef(true);
    const typingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    const pinned = useQuery(panel === "pinned" ? ["pinned", channel.channel_id] : null, () => listPinned(channel.channel_id));

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await listMessages(channel.channel_id);
            setMessages(res.messages);
            setHasMore(res.has_more);
            stickToBottom.current = true;
            void markRead(channel.channel_id).catch(() => {});
        } catch (err) {
            setError(err instanceof Error ? err.message : "Couldn't load messages.");
        } finally {
            setLoading(false);
        }
    }, [channel.channel_id]);

    useEffect(() => {
        // Fetching on channel change is synchronising with the server — the intended use of an effect.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void load();
    }, [load]);

    useLayoutEffect(() => {
        const el = scrollRef.current;
        if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
    }, [messages, typing]);

    async function loadOlder() {
        const el = scrollRef.current;
        if (!messages.length || !el) return;
        setLoadingOlder(true);
        const prevHeight = el.scrollHeight;
        try {
            const res = await listMessages(channel.channel_id, messages[0].message_id);
            stickToBottom.current = false;
            setMessages((m) => [...res.messages, ...m]);
            setHasMore(res.has_more);
            requestAnimationFrame(() => {
                el.scrollTop = el.scrollHeight - prevHeight;
            });
        } catch (err) {
            toast.error("Couldn't load older messages", err instanceof Error ? err.message : undefined);
        } finally {
            setLoadingOlder(false);
        }
    }

    // ── Real-time ──────────────────────────────────────────────────────────────
    useSocketEvent<Message>("message:new", (msg) => {
        if (msg.channel_id !== channel.channel_id) return;
        // The payload was serialized for the sender, so recompute ownership for this viewer.
        const local = { ...msg, is_mine: msg.sender_id === me };
        setMessages((list) => (list.some((m) => m.message_id === local.message_id) ? list : [...list, local]));
        setTyping((t) => t.filter((n) => n !== msg.sender_name));
        const el = scrollRef.current;
        stickToBottom.current = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 120;
        if (msg.sender_id !== me) void markRead(channel.channel_id).catch(() => {});
    });

    useSocketEvent<Message>("message:pinned", (msg) => {
        if (msg.channel_id !== channel.channel_id) return;
        setMessages((list) => list.map((m) => (m.message_id === msg.message_id ? { ...m, is_pinned: msg.is_pinned } : m)));
        if (panel === "pinned") void pinned.refetch();
    });

    useSocketEvent<{ message_id: number; channel_id: number; emoji: string; user_id: number; added: boolean }>(
        "message:reaction",
        (e) => {
            if (e.channel_id !== channel.channel_id || e.user_id === me) return; // our own toggle is applied optimistically
            setMessages((list) => list.map((m) => (m.message_id === e.message_id ? applyReaction(m, e.emoji, e.added, false) : m)));
        }
    );

    useSocketEvent<{ channel_id: number; user_name: string; is_typing: boolean }>("typing", (e) => {
        if (e.channel_id !== channel.channel_id || e.user_name === myName) return;
        setTyping((t) => (e.is_typing ? [...new Set([...t, e.user_name])] : t.filter((n) => n !== e.user_name)));
    });

    useEffect(() => () => clearTimeout(typingTimer.current), []);

    // ── Actions ────────────────────────────────────────────────────────────────
    function onDraftChange(value: string) {
        setDraft(value);
        if (!typingTimer.current) emitTyping(channel.channel_id, myName, true);
        clearTimeout(typingTimer.current);
        typingTimer.current = setTimeout(() => {
            emitTyping(channel.channel_id, myName, false);
            typingTimer.current = undefined;
        }, TYPING_IDLE_MS);
    }

    async function handleSend(e?: React.FormEvent) {
        e?.preventDefault();
        const content = draft.trim();
        if (!content || sending) return;
        setSending(true);
        try {
            const msg = await sendMessage(channel.channel_id, content, replyTo?.message_id);
            stickToBottom.current = true;
            setMessages((list) => (list.some((m) => m.message_id === msg.message_id) ? list : [...list, msg]));
            setDraft("");
            setReplyTo(null);
            clearTimeout(typingTimer.current);
            typingTimer.current = undefined;
            emitTyping(channel.channel_id, myName, false);
        } catch (err) {
            toast.error("Message not sent", err instanceof Error ? err.message : undefined);
        } finally {
            setSending(false);
        }
    }

    async function react(msg: Message, emoji: string) {
        const mine = msg.reactions.find((r) => r.emoji === emoji)?.mine ?? false;
        setMessages((list) => list.map((m) => (m.message_id === msg.message_id ? applyReaction(m, emoji, !mine, true) : m)));
        try {
            await toggleReaction(msg.message_id, emoji);
        } catch (err) {
            setMessages((list) => list.map((m) => (m.message_id === msg.message_id ? applyReaction(m, emoji, mine, true) : m)));
            toast.error("Couldn't react", err instanceof Error ? err.message : undefined);
        }
    }

    async function pin(msg: Message) {
        try {
            const updated = await togglePin(msg.message_id);
            setMessages((list) => list.map((m) => (m.message_id === msg.message_id ? { ...m, is_pinned: updated.is_pinned } : m)));
            toast.success(updated.is_pinned ? "Message pinned" : "Message unpinned");
            if (panel === "pinned") void pinned.refetch();
        } catch (err) {
            toast.error("Couldn't pin", err instanceof Error ? err.message : undefined);
        }
    }

    const readOnly = channel.is_broadcast && channel.channel_type === "broadcast" && !["owner", "manager"].includes(user?.role ?? "");

    return (
        <div className="flex min-h-0 flex-1">
            <div className="flex min-w-0 flex-1 flex-col">
                <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
                    <div className="flex min-w-0 items-center gap-2">
                        <ChannelIcon type={channel.channel_type} className="size-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                            <h3 className="truncate text-sm font-semibold">{channel.name.replace(/^#/, "")}</h3>
                            <p className="truncate text-xs text-muted-foreground">
                                {channel.member_count} member{channel.member_count === 1 ? "" : "s"}
                                {channel.description ? ` · ${channel.description}` : ""}
                            </p>
                        </div>
                    </div>
                    <div className="flex gap-1">
                        <Button
                            variant={panel === "pinned" ? "secondary" : "ghost"}
                            size="sm"
                            onClick={() => setPanel((p) => (p === "pinned" ? null : "pinned"))}
                            aria-pressed={panel === "pinned"}
                        >
                            <Pin /> Pinned
                        </Button>
                        <Button
                            variant={panel === "members" ? "secondary" : "ghost"}
                            size="sm"
                            onClick={() => setPanel((p) => (p === "members" ? null : "members"))}
                            aria-pressed={panel === "members"}
                        >
                            <Users /> <span className="hidden sm:inline">Members</span>
                        </Button>
                    </div>
                </header>

                <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3" aria-live="polite" aria-relevant="additions">
                    {error ? (
                        <ErrorState message={error} onRetry={load} />
                    ) : loading ? (
                        <div className="space-y-4">
                            {Array.from({ length: 5 }, (_, i) => (
                                <Skeleton key={i} className={cn("h-12", i % 2 ? "ml-auto w-1/2" : "w-2/3")} />
                            ))}
                        </div>
                    ) : messages.length === 0 ? (
                        <p className="py-16 text-center text-sm text-muted-foreground">No messages yet — say hello 👋</p>
                    ) : (
                        <>
                            {hasMore && (
                                <div className="mb-3 text-center">
                                    <Button variant="ghost" size="sm" onClick={loadOlder} disabled={loadingOlder}>
                                        {loadingOlder ? "Loading…" : "Load earlier messages"}
                                    </Button>
                                </div>
                            )}
                            <ol className="space-y-1">
                                {messages.map((m, i) => {
                                    const prev = messages[i - 1];
                                    const newDay = !prev || !isSameDay(fromServerUtc(prev.created_at), fromServerUtc(m.created_at));
                                    const grouped =
                                        !newDay && prev?.sender_id === m.sender_id &&
                                        fromServerUtc(m.created_at).getTime() - fromServerUtc(prev.created_at).getTime() < 5 * 60_000;
                                    return (
                                        <Fragment key={m.message_id}>
                                            {newDay && (
                                                <li className="py-3 text-center text-[11px] font-medium text-muted-foreground">
                                                    {formatDate(fromServerUtc(m.created_at), { weekday: "long" })}
                                                </li>
                                            )}
                                            <MessageRow
                                                message={m}
                                                grouped={grouped}
                                                onReply={() => setReplyTo(m)}
                                                onReact={(emoji) => react(m, emoji)}
                                                onPin={() => pin(m)}
                                            />
                                        </Fragment>
                                    );
                                })}
                            </ol>
                        </>
                    )}
                    {typing.length > 0 && (
                        <p className="mt-2 text-xs italic text-muted-foreground">
                            {typing.slice(0, 2).join(" and ")} {typing.length === 1 ? "is" : "are"} typing…
                        </p>
                    )}
                </div>

                {readOnly ? (
                    <p className="border-t border-border px-4 py-3 text-center text-xs text-muted-foreground">
                        Only managers can post in this broadcast channel.
                    </p>
                ) : (
                    <form onSubmit={handleSend} className="border-t border-border p-3">
                        {replyTo && (
                            <div className="mb-2 flex items-center justify-between gap-2 rounded-md bg-muted px-3 py-1.5 text-xs">
                                <span className="truncate">
                                    Replying to <span className="font-medium">{replyTo.sender_name}</span>: {replyTo.content}
                                </span>
                                <button type="button" onClick={() => setReplyTo(null)} aria-label="Cancel reply">
                                    <X className="size-3.5" />
                                </button>
                            </div>
                        )}
                        <div className="flex items-end gap-2">
                            <label htmlFor="composer" className="sr-only">
                                Message {channel.name}
                            </label>
                            <textarea
                                id="composer"
                                rows={1}
                                value={draft}
                                maxLength={4000}
                                onChange={(e) => onDraftChange(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" && !e.shiftKey) {
                                        e.preventDefault();
                                        void handleSend();
                                    }
                                }}
                                placeholder={`Message ${channel.channel_type === "direct" ? channel.name : `#${channel.name.replace(/^#/, "")}`} — use @name to mention`}
                                className="max-h-40 min-h-10 flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            />
                            <Button type="submit" size="icon-lg" disabled={!draft.trim() || sending} aria-label="Send message">
                                <Send />
                            </Button>
                        </div>
                    </form>
                )}
            </div>

            {panel && (
                <aside className="hidden w-64 shrink-0 flex-col border-l border-border lg:flex">
                    <div className="flex items-center justify-between border-b border-border px-4 py-3">
                        <h4 className="text-sm font-semibold">{panel === "pinned" ? "Pinned messages" : "Members"}</h4>
                        <button onClick={() => setPanel(null)} aria-label="Close panel" className="text-muted-foreground hover:text-foreground">
                            <X className="size-4" />
                        </button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-3">
                        {panel === "pinned" ? (
                            pinned.loading ? (
                                <Skeleton className="h-20" />
                            ) : pinned.error ? (
                                <ErrorState message={pinned.error.message} />
                            ) : !pinned.data?.length ? (
                                <p className="text-xs text-muted-foreground">Nothing pinned yet. Channel admins can pin important messages.</p>
                            ) : (
                                <ul className="space-y-2">
                                    {pinned.data.map((m) => (
                                        <li key={m.message_id} className="rounded-md border border-border p-2 text-xs">
                                            <p className="font-medium">{m.sender_name}</p>
                                            <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground">{m.content}</p>
                                        </li>
                                    ))}
                                </ul>
                            )
                        ) : (
                            <MembersPanel channel={channel} onChanged={onChannelsChanged} />
                        )}
                    </div>
                </aside>
            )}
        </div>
    );
}

function applyReaction(m: Message, emoji: string, added: boolean, isMe: boolean): Message {
    const existing = m.reactions.find((r) => r.emoji === emoji);
    let reactions = m.reactions;
    if (added) {
        reactions = existing
            ? reactions.map((r) => (r.emoji === emoji ? { ...r, count: r.count + 1, mine: r.mine || isMe } : r))
            : [...reactions, { emoji, count: 1, mine: isMe }];
    } else if (existing) {
        reactions = reactions
            .map((r) => (r.emoji === emoji ? { ...r, count: r.count - 1, mine: isMe ? false : r.mine } : r))
            .filter((r) => r.count > 0);
    }
    return { ...m, reactions };
}

function MessageRow({
    message: m,
    grouped,
    onReply,
    onReact,
    onPin,
}: {
    message: Message;
    grouped: boolean;
    onReply: () => void;
    onReact: (emoji: string) => void;
    onPin: () => void;
}) {
    const [picker, setPicker] = useState(false);
    const system = m.sender_id === null;

    if (system) {
        return <li className="py-1 text-center text-xs text-muted-foreground">{m.content}</li>;
    }

    return (
        <li className={cn("group relative flex gap-3 rounded-md px-2 py-1 hover:bg-muted/40", !grouped && "mt-3")}>
            <div className="w-8 shrink-0">{!grouped && <Avatar name={m.sender_name} initials={m.sender_initials} />}</div>
            <div className="min-w-0 flex-1">
                {!grouped && (
                    <p className="text-sm">
                        <span className="font-semibold text-foreground">{m.is_mine ? "You" : m.sender_name}</span>{" "}
                        <span className="text-[11px] text-muted-foreground">{formatTime(fromServerUtc(m.created_at))}</span>
                    </p>
                )}
                {m.reply_to && (
                    <p className="mb-0.5 truncate border-l-2 border-primary/40 pl-2 text-xs text-muted-foreground">
                        <span className="font-medium">{m.reply_to.sender_name}</span>: {m.reply_to.content}
                    </p>
                )}
                <p className={cn("whitespace-pre-wrap break-words text-sm", m.is_deleted ? "italic text-muted-foreground" : "text-foreground")}>
                    {m.is_pinned && <Pin className="mr-1 inline size-3 text-primary" aria-label="Pinned" />}
                    {renderContent(m.content)}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                    {m.reactions.map((r) => (
                        <button
                            key={r.emoji}
                            onClick={() => onReact(r.emoji)}
                            aria-pressed={r.mine}
                            className={cn(
                                "rounded-full border px-1.5 text-xs tabular-nums",
                                r.mine ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-background"
                            )}
                        >
                            {r.emoji} {r.count}
                        </button>
                    ))}
                    {m.is_mine && m.read_count > 0 && (
                        <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground" title="Read receipts">
                            <CheckCheck className="size-3" /> Seen by {m.read_count}
                        </span>
                    )}
                </div>
            </div>

            {!m.is_deleted && (
                <div className="absolute -top-3 right-2 hidden items-center rounded-md border border-border bg-popover shadow-sm group-focus-within:flex group-hover:flex">
                    <button onClick={() => setPicker((p) => !p)} className="p-1.5 text-muted-foreground hover:text-foreground" aria-label="Add reaction">
                        <SmilePlus className="size-3.5" />
                    </button>
                    <button onClick={onReply} className="p-1.5 text-muted-foreground hover:text-foreground" aria-label="Reply">
                        <CornerUpLeft className="size-3.5" />
                    </button>
                    <button onClick={onPin} className="p-1.5 text-muted-foreground hover:text-foreground" aria-label={m.is_pinned ? "Unpin" : "Pin"}>
                        {m.is_pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
                    </button>
                </div>
            )}
            {picker && (
                <div className="absolute right-2 top-5 z-10 flex gap-0.5 rounded-md border border-border bg-popover p-1 shadow-md">
                    {QUICK_REACTIONS.map((e) => (
                        <button
                            key={e}
                            onClick={() => {
                                onReact(e);
                                setPicker(false);
                            }}
                            className="rounded p-1 text-base hover:bg-muted"
                            aria-label={`React with ${e}`}
                        >
                            {e}
                        </button>
                    ))}
                </div>
            )}
        </li>
    );
}
