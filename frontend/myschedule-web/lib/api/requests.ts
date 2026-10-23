import { api, qs } from "./client";
import type { DropRequest, ShiftConflict, SwapRequest, TimeOffRequest } from "@/lib/types";

export async function listPendingSwaps(locationId: number): Promise<SwapRequest[]> {
    const res = await api.get<{ swaps: SwapRequest[] }>(`/swaps/pending-manager${qs({ location_id: locationId })}`);
    return res.swaps;
}

export async function decideSwap(
    swapId: number,
    approve: boolean
): Promise<{ swap: SwapRequest; conflicts: { requester: ShiftConflict[]; receiver: ShiftConflict[] } }> {
    return api.post(`/swaps/${swapId}/decide`, { approve });
}

export async function listPendingDrops(locationId: number): Promise<DropRequest[]> {
    const res = await api.get<{ drops: DropRequest[] }>(`/drops/pending${qs({ location_id: locationId })}`);
    return res.drops;
}

export async function decideDrop(dropId: number, approve: boolean): Promise<DropRequest> {
    const res = await api.post<{ drop: DropRequest }>(`/drops/${dropId}/decide`, { approve });
    return res.drop;
}

/** Time off is company-wide on the backend (not scoped to a location). */
export async function listPendingTimeOff(): Promise<TimeOffRequest[]> {
    const res = await api.get<{ requests: TimeOffRequest[] }>("/time-off/pending");
    return res.requests;
}

export async function decideTimeOff(
    requestId: number,
    approve: boolean,
    managerNotes?: string
): Promise<TimeOffRequest> {
    const res = await api.post<{ request: TimeOffRequest }>(`/time-off/${requestId}/decide`, {
        approve,
        manager_notes: managerNotes || undefined,
    });
    return res.request;
}

export type PendingCounts = { swaps: number; drops: number; timeOff: number; total: number };

export async function getPendingCounts(locationId: number): Promise<PendingCounts> {
    const [swaps, drops, timeOff] = await Promise.all([
        listPendingSwaps(locationId).catch(() => []),
        listPendingDrops(locationId).catch(() => []),
        listPendingTimeOff().catch(() => []),
    ]);
    return {
        swaps: swaps.length,
        drops: drops.length,
        timeOff: timeOff.length,
        total: swaps.length + drops.length + timeOff.length,
    };
}
