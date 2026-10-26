export type EmploymentStatus = "active" | "inactive" | "terminated";
export type EmploymentType = "full_time" | "part_time" | "casual";

/** Row from GET /admin/staff */
export type StaffMember = {
    user_id: number;
    username: string;
    display_name: string | null;
    email: string;
    role: string | null;
    emp_id: number;
    employment_type: EmploymentType;
    hourly_rate: number | null;
    start_date: string | null;
};

/** GET/PUT /admin/staff/:id/profile */
export type EmployeeProfile = {
    user_id: number;
    username: string;
    display_name: string | null;
    user_email: string;
    emp_id: number;
    role: string | null;
    role_id: number;
    status: EmploymentStatus;
    employment_type: EmploymentType;
    hourly_rate: number | null;
    max_hours_week: number | null;
    overtime_eligible: boolean;
    phone: string | null;
    emergency_contact: string | null;
    emergency_phone: string | null;
    notes: string | null;
    hire_date: string | null;
    location_id: number | null;
    /** Joined through an emailed invite, so "Resend invite" applies. */
    invited: boolean;
    /** Has a personal clock-in PIN for the punch-in tablet (never the PIN). */
    kiosk_pin_set?: boolean;
};

/** How an invite's login details reached the employee. temp_password is present only
 *  when the email did NOT go out, so the manager can pass it on in person. */
export type InviteDelivery = { email_sent: boolean; temp_password?: string };

export type EmployeeProfileUpdate = Partial<
    Pick<
        EmployeeProfile,
        | "hourly_rate"
        | "employment_type"
        | "max_hours_week"
        | "overtime_eligible"
        | "phone"
        | "emergency_contact"
        | "emergency_phone"
        | "notes"
    >
> & { status?: "active" | "inactive" };

export type TeamMemberStatus = "working" | "on_break" | "late" | "scheduled";

/** Row from GET /time-entries/team-status */
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
