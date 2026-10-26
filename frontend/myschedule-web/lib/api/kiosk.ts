import { api, qs } from "./client";

export type KioskDevice = {
    device_id: number;
    location_id: number;
    location_name: string | null;
    name: string;
    created_at: string;
    last_seen_at: string | null;
};

export async function listKioskDevices(locationId: number): Promise<KioskDevice[]> {
    return (await api.get<{ devices: KioskDevice[] }>(`/kiosk/devices${qs({ location_id: locationId })}`)).devices;
}

export async function removeKioskDevice(deviceId: number): Promise<void> {
    await api.delete(`/kiosk/devices/${deviceId}`);
}

/** Registers THIS browser as the location's punch-in tablet. The token goes straight
 *  into an httpOnly cookie and is never kept by page scripts. */
export async function setUpThisDeviceAsKiosk(locationId: number, name: string): Promise<void> {
    const { token } = await api.post<{ token: string }>("/kiosk/devices", { location_id: locationId, name });
    const res = await fetch("/api/kiosk/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
    });
    if (!res.ok) throw new Error("Couldn't set up this tablet.");
}

/** Managers reset a forgotten personal PIN; they never see it. */
export async function resetStaffPin(userId: number): Promise<void> {
    await api.delete(`/kiosk/pin/${userId}`);
}
