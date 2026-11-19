"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { isOutsideAvailability, isScheduleConflict, moveShift, unassignUser } from "@/lib/api/shifts";
import type { MoveTarget, Shift } from "@/lib/types";

type Pending = { shift: Shift; target: MoveTarget; label: string; message: string };

/**
 * Drag & drop goes through here: ONE validated request per drop (no request while
 * dragging). The server checks everyone on the shift against their resulting schedule:
 *  - a hard conflict (overlap, time off, not active) is shown and nothing changes
 *  - availability only → "Move anyway?" (the same override as assigning)
 *  - success → toast with the warnings (overtime…) and an Undo
 */
export function useShiftMover(onMoved: (shift: Shift) => void, names?: Map<number, string>) {
    const toast = useToast();
    const [busyId, setBusyId] = useState<number | null>(null);
    const [pending, setPending] = useState<Pending | null>(null);
    // Undo calls run again; a ref avoids the callback referring to itself.
    const runRef = useRef<(shift: Shift, target: MoveTarget, label: string, allowOutside?: boolean, isUndo?: boolean) => Promise<void>>(null);

    const run = useCallback(
        async (shift: Shift, target: MoveTarget, label: string, allowOutside = false, isUndo = false) => {
            setBusyId(shift.shift_id);
            try {
                const res = await moveShift(shift.shift_id, target, allowOutside);
                setPending(null);
                onMoved(res.shift);
                if (isUndo) {
                    toast.info("Change undone");
                    return;
                }
                const undo = res.undo;
                toast.success(label, res.warnings.length ? res.warnings.join(" · ") : undefined, {
                    label: "Undo",
                    onClick: () => {
                        // Undo restores what the manager already had; the server still checks it.
                        if (undo.to_user_id == null && undo.from_user_id != null) {
                            // The drop gave an open shift to someone: undo = take them off again,
                            // and put it back on its original day/time if that moved too.
                            void (async () => {
                                try {
                                    await unassignUser(shift.shift_id, undo.from_user_id!);
                                    const back = await moveShift(shift.shift_id, { date: undo.date, start: undo.start }, true).catch(() => null);
                                    onMoved(back?.shift ?? { ...res.shift, assignments: [] });
                                    toast.info("Change undone");
                                } catch (err) {
                                    toast.error("Couldn't undo", err instanceof Error ? err.message : undefined);
                                }
                            })();
                            return;
                        }
                        void runRef.current?.(res.shift, undo, "", true, true);
                    },
                });
            } catch (err) {
                if (!allowOutside && isOutsideAvailability(err)) {
                    setPending({ shift, target, label, message: err.message });
                } else {
                    setPending(null);
                    const msg = err instanceof Error ? err.message : undefined;
                    toast.error(isUndo ? "Couldn't undo" : isScheduleConflict(err) ? "Can't move this shift" : "That didn't work", msg);
                }
            } finally {
                setBusyId(null);
            }
        },
        [onMoved, toast]
    );

    useEffect(() => {
        runRef.current = run;
    }, [run]);

    const move = useCallback(
        (shift: Shift, target: MoveTarget, label: string) => void run(shift, target, label),
        [run]
    );

    const who = pending?.target.to_user_id ? names?.get(pending.target.to_user_id) : undefined;
    const dialog = (
        <ConfirmDialog
            open={!!pending}
            onOpenChange={(o) => !o && busyId === null && setPending(null)}
            title={who ? `Move to ${who} anyway?` : "Move anyway?"}
            description={`${pending?.message ?? ""}. Check with them before moving the shift.`}
            confirmLabel="Move anyway"
            pending={busyId !== null}
            onConfirm={() => pending && void run(pending.shift, pending.target, pending.label, true)}
        />
    );

    return { move, busyId, dialog };
}
