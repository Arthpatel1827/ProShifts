"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

type DialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    description?: string;
    children: React.ReactNode;
    footer?: React.ReactNode;
    size?: "sm" | "md" | "lg";
};

const SIZES = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl" };

export function Dialog({ open, onOpenChange, title, description, children, footer, size = "md" }: DialogProps) {
    return (
        <DialogPrimitive.Root open={open} onOpenChange={(next) => onOpenChange(next)}>
            <DialogPrimitive.Portal>
                <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/40 transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
                <DialogPrimitive.Popup
                    className={cn(
                        "fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-border bg-popover text-popover-foreground shadow-xl outline-none transition-all duration-150 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0",
                        SIZES[size]
                    )}
                >
                    <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
                        <div className="min-w-0">
                            <DialogPrimitive.Title className="text-base font-semibold">{title}</DialogPrimitive.Title>
                            {description && (
                                <DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">
                                    {description}
                                </DialogPrimitive.Description>
                            )}
                        </div>
                        <DialogPrimitive.Close
                            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            aria-label="Close"
                        >
                            <X className="size-4" />
                        </DialogPrimitive.Close>
                    </div>
                    <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
                    {footer && (
                        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3">
                            {footer}
                        </div>
                    )}
                </DialogPrimitive.Popup>
            </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
    );
}

type ConfirmProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    description: string;
    confirmLabel: string;
    destructive?: boolean;
    pending?: boolean;
    onConfirm: () => void;
};

export function ConfirmDialog({
    open,
    onOpenChange,
    title,
    description,
    confirmLabel,
    destructive,
    pending,
    onConfirm,
}: ConfirmProps) {
    return (
        <Dialog
            open={open}
            onOpenChange={onOpenChange}
            title={title}
            size="sm"
            footer={
                <>
                    <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
                        Cancel
                    </Button>
                    <Button
                        variant={destructive ? "destructive" : "default"}
                        onClick={onConfirm}
                        disabled={pending}
                    >
                        {pending ? "Working…" : confirmLabel}
                    </Button>
                </>
            }
        >
            <p className="text-sm text-muted-foreground">{description}</p>
        </Dialog>
    );
}
