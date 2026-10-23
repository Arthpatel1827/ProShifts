import { api, qs } from "./client";
import type { Channel, ChannelMember, Message } from "@/lib/types";

export async function listChannels(): Promise<Channel[]> {
    const res = await api.get<{ channels: Channel[] }>("/messaging/channels");
    return res.channels;
}

/** Creates #general and one channel per role for a location (idempotent on the backend). */
export async function setupChannels(locationId: number): Promise<void> {
    await api.post("/messaging/channels/setup", { location_id: locationId });
}

export async function createGroup(input: {
    name: string;
    member_ids: number[];
    description?: string;
    is_broadcast?: boolean;
}): Promise<Channel> {
    const res = await api.post<{ channel: Channel }>("/messaging/channels/group", input);
    return res.channel;
}

export async function openDirectMessage(userId: number): Promise<Channel> {
    const res = await api.post<{ channel: Channel }>("/messaging/channels/dm", { user_id: userId });
    return res.channel;
}

export async function createShiftThread(shiftId: number): Promise<Channel> {
    const res = await api.post<{ channel: Channel }>(`/messaging/shifts/${shiftId}/thread`);
    return res.channel;
}

export async function listMessages(
    channelId: number,
    beforeId?: number
): Promise<{ messages: Message[]; has_more: boolean }> {
    return api.get(`/messaging/channels/${channelId}/messages${qs({ before_id: beforeId, limit: 50 })}`);
}

export async function sendMessage(channelId: number, content: string, replyToId?: number): Promise<Message> {
    const res = await api.post<{ message: Message }>(`/messaging/channels/${channelId}/messages`, {
        content,
        reply_to_id: replyToId,
    });
    return res.message;
}

export async function markRead(channelId: number): Promise<void> {
    await api.post(`/messaging/channels/${channelId}/read`);
}

export async function listPinned(channelId: number): Promise<Message[]> {
    const res = await api.get<{ messages: Message[] }>(`/messaging/channels/${channelId}/pinned`);
    return res.messages;
}

export async function listMembers(channelId: number): Promise<ChannelMember[]> {
    const res = await api.get<{ members: ChannelMember[] }>(`/messaging/channels/${channelId}/members`);
    return res.members;
}

export async function addMember(channelId: number, userId: number): Promise<void> {
    await api.post(`/messaging/channels/${channelId}/members`, { user_id: userId });
}

export async function togglePin(messageId: number): Promise<Message> {
    const res = await api.post<{ message: Message }>(`/messaging/messages/${messageId}/pin`);
    return res.message;
}

export async function toggleReaction(messageId: number, emoji: string): Promise<boolean> {
    const res = await api.post<{ added: boolean }>(`/messaging/messages/${messageId}/react`, { emoji });
    return res.added;
}
