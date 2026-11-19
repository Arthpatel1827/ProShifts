"use client";

import { useState } from "react";
import { AlertTriangle, Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Shown when the invite email didn't go out: the manager passes these details on in person. */
export function LoginDetails({ email, password }: { email: string; password: string }) {
    const [copied, setCopied] = useState(false);

    async function copy() {
        try {
            await navigator.clipboard.writeText(`Email: ${email}\nTemporary password: ${password}`);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // Clipboard can be blocked; the details are still on screen to copy by hand.
        }
    }

    return (
        <div className="space-y-3">
            <div role="alert" className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3.5 py-3 text-sm">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                <p className="text-foreground">
                    <span className="font-medium">The email wasn&apos;t sent.</span> Share these login details with them directly. They
                    sign in to the ProShifts mobile app and should change the password right away.
                </p>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-lg border border-border px-4 py-3 text-sm">
                <dt className="text-muted-foreground">Email</dt>
                <dd className="font-medium text-foreground break-all">{email}</dd>
                <dt className="text-muted-foreground">Temporary password</dt>
                <dd className="font-mono font-medium text-foreground break-all" data-testid="temp-password">
                    {password}
                </dd>
            </dl>
            <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">This password is shown only once.</p>
                <Button variant="outline" size="sm" onClick={copy}>
                    {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy details"}
                </Button>
            </div>
        </div>
    );
}
