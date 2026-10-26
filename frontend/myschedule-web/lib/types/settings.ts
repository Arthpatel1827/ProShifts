// GET/PUT /time-entries/settings — company-wide clock-in rules.
export type ClockInMethod = "gps" | "qr_pin" | "kiosk_pin" | "manager_only";

export type ClockSettings = {
    clock_in_method: ClockInMethod;
    break_duration_mins: number;
    /** null = unlimited */
    max_breaks_per_shift: number | null;
    paid_break: boolean;
    gps_radius_meters: number;
    /** When today's PIN stops working (ISO); null when no PIN is active. Never the PIN itself. */
    pin_expires_at: string | null;
};
