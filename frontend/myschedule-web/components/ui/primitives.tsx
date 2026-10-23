// Small presentational building blocks shared across manager pages.
import { cn } from "@/lib/utils";
import { toneClasses, type Tone } from "@/lib/theme/tokens";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
    return <div className={cn("rounded-xl border border-border bg-card text-card-foreground", className)} {...props} />;
}

export function CardHeader({
    title,
    description,
    action,
    className,
}: {
    title: React.ReactNode;
    description?: React.ReactNode;
    action?: React.ReactNode;
    className?: string;
}) {
    return (
        <div className={cn("flex items-start justify-between gap-3 px-5 pt-4 pb-3", className)}>
            <div className="min-w-0">
                <h2 className="text-sm font-semibold text-foreground">{title}</h2>
                {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
            </div>
            {action}
        </div>
    );
}

export function Badge({
    tone = "neutral",
    className,
    children,
}: {
    tone?: Tone;
    className?: string;
    children: React.ReactNode;
}) {
    return (
        <span
            className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap",
                toneClasses[tone],
                className
            )}
        >
            {children}
        </span>
    );
}

export function Skeleton({ className }: { className?: string }) {
    return <div className={cn("animate-pulse rounded-md bg-muted", className)} />;
}

export function EmptyState({
    icon: Icon,
    title,
    description,
    action,
    className,
}: {
    icon?: React.ComponentType<{ className?: string }>;
    title: string;
    description?: string;
    action?: React.ReactNode;
    className?: string;
}) {
    return (
        <div className={cn("flex flex-col items-center justify-center px-6 py-10 text-center", className)}>
            {Icon && (
                <div className="mb-3 rounded-full bg-muted p-3">
                    <Icon className="size-5 text-muted-foreground" />
                </div>
            )}
            <p className="text-sm font-medium text-foreground">{title}</p>
            {description && <p className="mt-1 max-w-sm text-xs text-muted-foreground">{description}</p>}
            {action && <div className="mt-4">{action}</div>}
        </div>
    );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
    return (
        <div
            role="alert"
            className="flex items-center justify-between gap-3 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
            <span>{message}</span>
            {onRetry && (
                <button onClick={onRetry} className="shrink-0 font-medium underline-offset-4 hover:underline">
                    Try again
                </button>
            )}
        </div>
    );
}

export function Avatar({ name, initials, className }: { name: string; initials?: string; className?: string }) {
    const text =
        initials ||
        name
            .trim()
            .split(/\s+/)
            .slice(0, 2)
            .map((p) => p[0]?.toUpperCase() ?? "")
            .join("") ||
        "?";
    return (
        <span
            aria-hidden
            className={cn(
                "inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary",
                className
            )}
        >
            {text}
        </span>
    );
}

export function Stat({
    label,
    value,
    hint,
    tone,
    loading,
}: {
    label: string;
    value: React.ReactNode;
    hint?: React.ReactNode;
    tone?: Tone;
    loading?: boolean;
}) {
    return (
        <Card className="px-5 py-4">
            <p className="text-xs font-medium text-muted-foreground">{label}</p>
            {loading ? (
                <Skeleton className="mt-2 h-7 w-24" />
            ) : (
                <p
                    className={cn(
                        "mt-1 text-2xl font-semibold tabular-nums tracking-tight",
                        tone === "danger" && "text-destructive",
                        tone === "success" && "text-success",
                        tone === "primary" && "text-primary"
                    )}
                >
                    {value}
                </p>
            )}
            {hint && !loading && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
        </Card>
    );
}
