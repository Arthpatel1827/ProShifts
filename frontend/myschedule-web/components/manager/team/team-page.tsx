"use client";

import { useMemo, useState } from "react";
import { Search, UserPlus, Users } from "lucide-react";
import { useManager } from "@/components/manager/manager-context";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { Avatar, Badge, Card, EmptyState, ErrorState, Skeleton } from "@/components/ui/primitives";
import { listStaff, getTeamStatus } from "@/lib/api/team";
import { useQuery } from "@/lib/hooks/use-query";
import { formatDate, formatMoney, titleCase } from "@/lib/format";
import { teamStatusTone } from "@/lib/theme/tokens";
import { EmployeeDialog } from "./employee-dialog";
import { InviteDialog } from "./invite-dialog";

export default function TeamPage() {
    const { location, user } = useManager();
    const locationId = location?.id ?? null;
    const staff = useQuery(locationId ? ["staff", locationId] : null, () => listStaff(locationId!));
    const status = useQuery(locationId ? ["team-status", locationId] : null, () => getTeamStatus(locationId!));

    const [search, setSearch] = useState("");
    const [role, setRole] = useState("");
    const [selected, setSelected] = useState<number | null>(null);
    const [inviteOpen, setInviteOpen] = useState(false);

    // Supervisors can list staff, but profile endpoints are owner/manager only.
    const canEdit = ["owner", "manager"].includes(user?.role ?? "");

    const roles = useMemo(
        () => [...new Set((staff.data ?? []).map((s) => s.role).filter((r): r is string => !!r))].sort(),
        [staff.data]
    );
    const statusById = useMemo(() => new Map((status.data ?? []).map((m) => [m.user_id, m])), [status.data]);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return (staff.data ?? [])
            .filter((s) => !role || s.role === role)
            .filter(
                (s) =>
                    !q ||
                    [s.display_name, s.username, s.email].some((v) => v?.toLowerCase().includes(q))
            )
            .sort((a, b) => (a.display_name || a.username).localeCompare(b.display_name || b.username));
    }, [staff.data, search, role]);

    return (
        <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h2 className="text-lg font-semibold text-foreground">Team</h2>
                    <p className="text-sm text-muted-foreground">
                        {staff.data ? `${staff.data.length} active at ${location?.name}` : "Loading…"}
                    </p>
                </div>
                {canEdit && (
                    <Button size="lg" onClick={() => setInviteOpen(true)}>
                        <UserPlus /> Invite staff
                    </Button>
                )}
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
                <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <label htmlFor="team-search" className="sr-only">
                        Search staff
                    </label>
                    <Input
                        id="team-search"
                        type="search"
                        placeholder="Search by name or email"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="pl-9"
                    />
                </div>
                <label htmlFor="team-role" className="sr-only">
                    Filter by role
                </label>
                <Select id="team-role" value={role} onChange={(e) => setRole(e.target.value)} className="sm:w-48">
                    <option value="">All roles</option>
                    {roles.map((r) => (
                        <option key={r} value={r}>
                            {r}
                        </option>
                    ))}
                </Select>
            </div>

            {staff.error && <ErrorState message={staff.error.message} onRetry={staff.refetch} />}

            <Card className="overflow-hidden">
                {staff.loading ? (
                    <div className="space-y-3 p-5">
                        {Array.from({ length: 6 }, (_, i) => (
                            <Skeleton key={i} className="h-12" />
                        ))}
                    </div>
                ) : filtered.length === 0 ? (
                    <EmptyState
                        icon={Users}
                        title={staff.data?.length ? "No one matches those filters" : "No staff yet"}
                        description={staff.data?.length ? undefined : "Invite your team so you can start scheduling them."}
                        action={
                            !staff.data?.length && canEdit ? (
                                <Button onClick={() => setInviteOpen(true)}>
                                    <UserPlus /> Invite staff
                                </Button>
                            ) : undefined
                        }
                    />
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                                <tr>
                                    <th className="px-5 py-2.5 font-medium">Name</th>
                                    <th className="px-3 py-2.5 font-medium">Role</th>
                                    <th className="hidden px-3 py-2.5 font-medium md:table-cell">Type</th>
                                    <th className="hidden px-3 py-2.5 font-medium md:table-cell">Rate</th>
                                    <th className="hidden px-3 py-2.5 font-medium lg:table-cell">Started</th>
                                    <th className="px-5 py-2.5 font-medium">Today</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {filtered.map((s) => {
                                    const name = s.display_name || s.username;
                                    const live = statusById.get(s.user_id);
                                    const tone = live ? teamStatusTone[live.status] : null;
                                    return (
                                        <tr
                                            key={s.user_id}
                                            className={canEdit ? "cursor-pointer transition-colors hover:bg-muted/40" : ""}
                                            onClick={canEdit ? () => setSelected(s.user_id) : undefined}
                                        >
                                            <td className="px-5 py-3">
                                                <div className="flex items-center gap-3">
                                                    <Avatar name={name} />
                                                    <div className="min-w-0">
                                                        {canEdit ? (
                                                            <button
                                                                className="truncate font-medium text-foreground hover:underline"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setSelected(s.user_id);
                                                                }}
                                                            >
                                                                {name}
                                                            </button>
                                                        ) : (
                                                            <p className="truncate font-medium text-foreground">{name}</p>
                                                        )}
                                                        <p className="truncate text-xs text-muted-foreground">{s.email}</p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-3 py-3">{s.role ?? "—"}</td>
                                            <td className="hidden px-3 py-3 text-muted-foreground md:table-cell">
                                                {titleCase(s.employment_type)}
                                            </td>
                                            <td className="hidden px-3 py-3 tabular-nums text-muted-foreground md:table-cell">
                                                {s.hourly_rate != null ? `${formatMoney(s.hourly_rate)}/h` : "Not set"}
                                            </td>
                                            <td className="hidden px-3 py-3 text-muted-foreground lg:table-cell">
                                                {s.start_date ? formatDate(s.start_date, { year: "numeric", weekday: undefined }) : "—"}
                                            </td>
                                            <td className="px-5 py-3">
                                                {tone ? (
                                                    <Badge tone={tone.tone}>{tone.label}</Badge>
                                                ) : (
                                                    <span className="text-xs text-muted-foreground">Off</span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </Card>

            <EmployeeDialog
                userId={selected}
                onClose={() => setSelected(null)}
                onSaved={() => void staff.refetch()}
            />
            {locationId && (
                <InviteDialog
                    open={inviteOpen}
                    onOpenChange={setInviteOpen}
                    locationId={locationId}
                    roles={roles}
                    onInvited={() => void staff.refetch()}
                />
            )}
        </div>
    );
}
