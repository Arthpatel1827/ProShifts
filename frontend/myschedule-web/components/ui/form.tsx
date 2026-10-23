// Form controls styled to match the existing login page inputs.
import { cn } from "@/lib/utils";

const control =
    "w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition-shadow placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-destructive";

export function Field({
    label,
    htmlFor,
    error,
    hint,
    children,
    className,
}: {
    label: string;
    htmlFor: string;
    error?: string | null;
    hint?: string;
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <div className={cn("space-y-1.5", className)}>
            <label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
                {label}
            </label>
            {children}
            {error ? (
                <p className="text-xs text-destructive" role="alert">
                    {error}
                </p>
            ) : hint ? (
                <p className="text-xs text-muted-foreground">{hint}</p>
            ) : null}
        </div>
    );
}

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
    return <input className={cn(control, className)} {...props} />;
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
    return <textarea className={cn(control, "min-h-20 resize-y", className)} {...props} />;
}

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
    return <select className={cn(control, "pr-8", className)} {...props} />;
}

export function FormError({ message }: { message?: string | null }) {
    if (!message) return null;
    return (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {message}
        </p>
    );
}
