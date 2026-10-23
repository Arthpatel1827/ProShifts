import { CalendarClock, Hash, Megaphone, User, Users } from "lucide-react";

export function ChannelIcon({ type, className }: { type: string; className?: string }) {
    switch (type) {
        case "direct":
            return <User className={className} />;
        case "group":
            return <Users className={className} />;
        case "broadcast":
            return <Megaphone className={className} />;
        case "shift":
            return <CalendarClock className={className} />;
        default:
            return <Hash className={className} />;
    }
}
