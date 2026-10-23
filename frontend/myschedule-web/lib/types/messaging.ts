export type ChannelType = "general" | "role" | "group" | "broadcast" | "direct" | "shift";

export type Reaction = { emoji: string; count: number; mine: boolean };

export type Message = {
    message_id: number;
    channel_id: number;
    content: string;
    is_deleted: boolean;
    is_pinned: boolean;
    sender_id: number | null;
    sender_name: string;
    sender_initials: string;
    is_mine: boolean;
    reply_to: { message_id: number; content: string; sender_name: string } | null;
    reactions: Reaction[];
    read_count: number;
    created_at: string;
    updated_at: string;
};

export type Channel = {
    channel_id: number;
    name: string;
    channel_type: ChannelType | string;
    is_broadcast: boolean;
    description: string | null;
    location_id: number | null;
    shift_id: number | null;
    unread: number;
    member_count: number;
    last_message: Message | null;
};

export type ChannelMember = {
    user_id: number;
    name: string;
    initials: string;
    is_admin: boolean;
    joined_at: string;
};
