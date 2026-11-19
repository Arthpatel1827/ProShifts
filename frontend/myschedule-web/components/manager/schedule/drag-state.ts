// What is being dragged right now. dataTransfer can't be read during dragover in every
// browser, so drop targets read this to highlight valid/invalid cells while dragging.
import type { Shift } from "@/lib/types";

export type DragItem = { shift: Shift; fromUserId: number | null };

let current: DragItem | null = null;
const listeners = new Set<() => void>();

export const dragState = {
    get: () => current,
    set(item: DragItem | null) {
        current = item;
        listeners.forEach((l) => l());
    },
    subscribe(l: () => void) {
        listeners.add(l);
        return () => {
            listeners.delete(l);
        };
    },
};

export const DRAG_MIME = "application/x-proshifts-shift";
