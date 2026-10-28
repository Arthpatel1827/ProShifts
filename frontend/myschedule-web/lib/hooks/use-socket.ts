"use client";

import { useEffect, useEffectEvent, useSyncExternalStore } from "react";
import { io, type Socket } from "socket.io-client";

// One Socket.IO connection per browser tab, shared by every hook below.
// The Flask server authenticates the handshake with the JWT access token
// (routes/sockets.py), so we fetch it from /api/auth/socket-token on each (re)connect.

// Behind the reverse proxy (docker-compose / Caddy) Socket.IO is served from the same
// origin as the app, so the default is the page's own origin. Local dev without the
// proxy sets NEXT_PUBLIC_SOCKET_URL=http://localhost:5000.
function socketUrl(): string {
    return process.env.NEXT_PUBLIC_SOCKET_URL || window.location.origin;
}

let socket: Socket | null = null;
// Reference counts, so two components watching the same room don't leave it for each other.
const joinedLocations = new Map<number, number>();
const joinedChannels = new Map<number, number>();

function retain(map: Map<number, number>, id: number): boolean {
    const n = map.get(id) ?? 0;
    map.set(id, n + 1);
    return n === 0;
}

function release(map: Map<number, number>, id: number): boolean {
    const n = (map.get(id) ?? 1) - 1;
    if (n <= 0) map.delete(id);
    else map.set(id, n);
    return n <= 0;
}

async function fetchToken(): Promise<string | null> {
    try {
        const res = await fetch("/api/auth/socket-token", { method: "POST" });
        if (!res.ok) return null;
        const data = (await res.json()) as { token?: string };
        return data.token ?? null;
    } catch {
        return null;
    }
}

function getSocket(): Socket {
    if (socket) return socket;
    socket = io(socketUrl(), {
        // Called on every connection attempt, so reconnects pick up a refreshed token.
        auth: (cb) => {
            void fetchToken().then((token) => cb({ token: token ?? "" }));
        },
        transports: ["websocket"],
        reconnection: true,
        reconnectionDelay: 2000,
        reconnectionAttempts: 10,
    });
    // Rooms are per-connection on the server; rejoin after any reconnect.
    socket.on("connect", () => {
        joinedLocations.forEach((_, id) => socket?.emit("join", { location_id: id }));
        if (joinedChannels.size) socket?.emit("messaging:join", { channel_ids: [...joinedChannels.keys()] });
    });
    return socket;
}

function subscribeConnection(onChange: () => void) {
    const s = getSocket();
    s.on("connect", onChange);
    s.on("disconnect", onChange);
    return () => {
        s.off("connect", onChange);
        s.off("disconnect", onChange);
    };
}

export function useSocketConnected(): boolean {
    return useSyncExternalStore(
        subscribeConnection,
        () => getSocket().connected,
        () => false
    );
}

/** Subscribe to a server event for the lifetime of the component. */
export function useSocketEvent<T = unknown>(event: string, handler: (payload: T) => void) {
    const onEvent = useEffectEvent(handler);
    useEffect(() => {
        const s = getSocket();
        const fn = (payload: T) => onEvent(payload);
        s.on(event, fn);
        return () => {
            s.off(event, fn);
        };
    }, [event]);
}

/** Join a location room and re-run `onChange` (debounced) whenever any of `events` fires. */
export function useLiveRefresh(locationId: number | null, events: string[], onChange: () => void) {
    const onEvent = useEffectEvent(onChange);
    const eventsKey = events.join("|");

    useEffect(() => {
        if (!locationId) return;
        const s = getSocket();
        if (retain(joinedLocations, locationId) && s.connected) s.emit("join", { location_id: locationId });

        let timer: ReturnType<typeof setTimeout> | undefined;
        const fn = () => {
            clearTimeout(timer);
            timer = setTimeout(() => onEvent(), 400);
        };
        const names = eventsKey.split("|");
        names.forEach((e) => s.on(e, fn));
        return () => {
            clearTimeout(timer);
            names.forEach((e) => s.off(e, fn));
            if (release(joinedLocations, locationId)) s.emit("leave", { location_id: locationId });
        };
    }, [locationId, eventsKey]);
}

/** Join the socket rooms for the given messaging channels. */
export function useChannelRooms(channelIds: number[]) {
    const key = [...channelIds].sort((a, b) => a - b).join(",");
    useEffect(() => {
        if (!key) return;
        const ids = key.split(",").map(Number);
        const s = getSocket();
        const fresh = ids.filter((id) => retain(joinedChannels, id));
        if (fresh.length && s.connected) s.emit("messaging:join", { channel_ids: fresh });
        return () => {
            ids.forEach((id) => {
                if (release(joinedChannels, id)) s.emit("messaging:leave", { channel_id: id });
            });
        };
    }, [key]);
}

export function emitTyping(channelId: number, userName: string, isTyping: boolean) {
    getSocket().emit(isTyping ? "typing:start" : "typing:stop", { channel_id: channelId, user_name: userName });
}
