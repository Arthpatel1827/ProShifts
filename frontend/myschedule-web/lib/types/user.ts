export type Role = {
    role_id: number;
    name: string;
    location_id: number;
    is_system: boolean;
};

/** Shape returned by GET /admin/locations. */
export type Location = {
    id: number;
    name: string;
    address?: string | null;
    timezone: string;
    loc_lat?: number | null;
    loc_lng?: number | null;
};

/** Shape returned by AuthService.serialize_user (login and /auth/me). */
export type User = {
    user_id: number;
    username: string;
    user_email: string;
    display_name: string | null;
    is_verified: boolean;
    /** Lower-cased role name at the user's active employment, e.g. "owner". */
    role: string | null;
    company_id: number | null;
    location_id: number | null;
};
