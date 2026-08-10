export type Role = {
    role_id: number;
    name: string;
    location_id: number;
    is_system: boolean;
};

export type Location = {
    id: number;
    name: string;
    lat?: number;
    lng?: number;
    timezone: string;
};

export type User = {
    user_id: number;
    username: string;
    user_email: string;
    display_name: string | null;
    is_verified: boolean;
    role: Role | null;
    primaryLocation: Location | null;
    created_at: string;
};