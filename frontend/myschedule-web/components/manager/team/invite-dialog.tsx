"use client";

import { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { inviteStaff } from "@/lib/api/team";
import { LoginDetails } from "./login-details";

type Props = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    locationId: number;
    /** Existing role names, offered as suggestions. */
    roles: string[];
    onInvited: () => void;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function InviteDialog({ open, onOpenChange, locationId, roles, onInvited }: Props) {
    const toast = useToast();
    const [email, setEmail] = useState("");
    const [position, setPosition] = useState("");
    const [emailError, setEmailError] = useState<string | null>(null);
    const [formError, setFormError] = useState<string | null>(null);
    const [sending, setSending] = useState(false);
    // Set when the account was created but the email didn't go out.
    const [unsent, setUnsent] = useState<{ email: string; password: string } | null>(null);

    const [wasOpen, setWasOpen] = useState(open);
    if (open !== wasOpen) {
        setWasOpen(open);
        if (open) {
            setEmail("");
            setPosition("");
            setEmailError(null);
            setFormError(null);
            setUnsent(null);
        }
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setFormError(null);
        const trimmed = email.trim().toLowerCase();
        if (!EMAIL_RE.test(trimmed)) {
            setEmailError("Enter a valid email address.");
            return;
        }
        setEmailError(null);
        setSending(true);
        try {
            const res = await inviteStaff({ email: trimmed, location_id: locationId, position: position.trim() || "Staff" });
            onInvited();
            if (res.email_sent || !res.temp_password) {
                toast.success("Invite sent", `${trimmed} will get an email with a temporary password for the mobile app.`);
                onOpenChange(false);
            } else {
                setUnsent({ email: trimmed, password: res.temp_password });
            }
        } catch (err) {
            setFormError(err instanceof Error ? err.message : "Couldn't send the invite.");
        } finally {
            setSending(false);
        }
    }

    return (
        <Dialog
            open={open}
            onOpenChange={(o) => !sending && onOpenChange(o)}
            title={unsent ? "Account created" : "Invite staff"}
            description={unsent ? undefined : "They'll receive an email with a temporary password to sign in to the MySchedule app."}
            footer={
                unsent ? (
                    <Button onClick={() => onOpenChange(false)}>Done</Button>
                ) : (
                    <>
                        <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={sending}>
                            Cancel
                        </Button>
                        <Button type="submit" form="invite-form" disabled={sending}>
                            {sending ? "Sending…" : "Send invite"}
                        </Button>
                    </>
                )
            }
        >
            {unsent ? (
                <LoginDetails email={unsent.email} password={unsent.password} />
            ) : (
                <form id="invite-form" onSubmit={handleSubmit} className="space-y-4" noValidate>
                    <FormError message={formError} />
                    <Field label="Email" htmlFor="invite-email" error={emailError}>
                        <Input
                            id="invite-email"
                            type="email"
                            autoComplete="off"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            aria-invalid={!!emailError}
                            required
                            autoFocus
                        />
                    </Field>
                    <Field label="Role" htmlFor="invite-role" hint="Pick an existing role or type a new one.">
                        <Input
                            id="invite-role"
                            list="invite-role-options"
                            placeholder="Staff"
                            value={position}
                            maxLength={50}
                            onChange={(e) => setPosition(e.target.value)}
                        />
                        <datalist id="invite-role-options">
                            {roles.map((r) => (
                                <option key={r} value={r} />
                            ))}
                        </datalist>
                    </Field>
                </form>
            )}
        </Dialog>
    );
}
