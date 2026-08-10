export type EmploymentStatus = "active" | "inactive" | "terminated";
export type EmploymentType = "full_time" | "part_time" | "casual";

export type Employment = {
    emp_id: number;
    user_id: number;
    comp_id: number;
    location_id: number;
    role_id: number;
    status: EmploymentStatus;
    start_date: string;
    hourly_rate: number;
    employment_type: EmploymentType;
    max_hours_week: number;
    overtime_eligible: boolean;
    phone?: string | null;
    emergency_contact?: string | null;
    emergency_phone?: string | null;
    notes?: string | null;
};

export type TeamMemberStatus = "working" | "on_break" | "late" | "scheduled";

export type TeamMember = {
    user_id: number;
    name: string;
    initials: string;
    role: string;
    status: TeamMemberStatus;
    shift_start?: string | null;
    shift_end?: string | null;
    clocked_in?: string | null;
};