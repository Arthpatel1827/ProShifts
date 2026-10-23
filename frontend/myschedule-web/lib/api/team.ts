import { api, qs } from "./client";
import type { EmployeeProfile, EmployeeProfileUpdate, StaffMember, TeamMember } from "@/lib/types";

export async function listStaff(locationId: number): Promise<StaffMember[]> {
    const res = await api.get<{ staff: StaffMember[] }>(`/admin/staff${qs({ location_id: locationId })}`);
    return res.staff;
}

export async function getEmployeeProfile(userId: number): Promise<EmployeeProfile> {
    const res = await api.get<{ profile: EmployeeProfile }>(`/admin/staff/${userId}/profile`);
    return res.profile;
}

export async function updateEmployeeProfile(
    userId: number,
    update: EmployeeProfileUpdate
): Promise<EmployeeProfile> {
    const res = await api.put<{ profile: EmployeeProfile }>(`/admin/staff/${userId}/profile`, update);
    return res.profile;
}

/** Today's scheduled staff with live clock status. */
export async function getTeamStatus(locationId: number): Promise<TeamMember[]> {
    const res = await api.get<{ team: TeamMember[] }>(`/time-entries/team-status${qs({ location_id: locationId })}`);
    return res.team;
}

/** POST /onboarding/invite — creates the account and emails a temporary password. */
export async function inviteStaff(input: {
    email: string;
    location_id: number;
    position: string;
}): Promise<{ user_id: number; invite_id: number; email: string }> {
    const res = await api.post<{ result: { user_id: number; invite_id: number; email: string } }>(
        "/onboarding/invite",
        input
    );
    return res.result;
}
