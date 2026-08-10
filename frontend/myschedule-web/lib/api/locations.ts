import { apiFetch } from "./client";
import type { Location } from "@/lib/types";

export async function listLocations(): Promise<Location[]> {
    const res = await apiFetch<{ locations: Location[] }>("/admin/locations");
    return res.locations;
}