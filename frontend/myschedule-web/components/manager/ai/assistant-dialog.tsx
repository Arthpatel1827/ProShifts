"use client";

import { useEffect, useRef, useState } from "react";
import { Database, Loader2, SendHorizontal } from "lucide-react";
import { useManager } from "@/components/manager/manager-context";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ErrorState } from "@/components/ui/primitives";
import { Textarea } from "@/components/ui/form";
import { aiErrorMessage, askAssistant } from "@/lib/api/ai";
import type { AssistantTurn, ToolUse } from "@/lib/types";
import { AIMark, TOOL_LABELS } from "./ai-common";

type Turn = AssistantTurn & { tools?: ToolUse[] };

const EXAMPLES = [
    "Who is available Friday evening?",
    "Who is close to overtime this week?",
    "Why is labor cost higher this week?",
    "Which shifts have nobody assigned?",
    "Who has the fewest scheduled hours this week?",
];

export function AssistantDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
    const { location } = useManager();
    const [turns, setTurns] = useState<Turn[]>([]);
    const [input, setInput] = useState("");
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const endRef = useRef<HTMLDivElement>(null);

    // A conversation belongs to one location; switching locations starts fresh.
    const [convLocation, setConvLocation] = useState(location?.id);
    if (convLocation !== location?.id) {
        setConvLocation(location?.id);
        setTurns([]);
        setError(null);
    }

    useEffect(() => {
        endRef.current?.scrollIntoView({ block: "end" });
    }, [turns, pending]);

    async function ask(text: string) {
        const message = text.trim();
        if (!message || !location || pending) return;
        const history = turns.map(({ role, content }) => ({ role, content }));
        setTurns((t) => [...t, { role: "user", content: message }]);
        setInput("");
        setError(null);
        setPending(true);
        try {
            const res = await askAssistant(location.id, message, history);
            setTurns((t) => [...t, { role: "assistant", content: res.reply, tools: res.tools_used }]);
        } catch (err) {
            setError(aiErrorMessage(err));
            setTurns((t) => t.slice(0, -1)); // let them retry the same question
            setInput(message);
        } finally {
            setPending(false);
        }
    }

    return (
        <Dialog
            open={open}
            onOpenChange={onOpenChange}
            size="lg"
            title="ProShifts AI"
            description={`Ask about your team at ${location?.name ?? "this location"}. Answers come from your schedule data.`}
            footer={
                <form
                    className="flex w-full items-end gap-2"
                    onSubmit={(e) => {
                        e.preventDefault();
                        void ask(input);
                    }}
                >
                    <label htmlFor="ai-question" className="sr-only">
                        Ask about your workforce
                    </label>
                    <Textarea
                        id="ai-question"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                void ask(input);
                            }
                        }}
                        placeholder="Ask about your workforce…"
                        rows={1}
                        className="min-h-10 flex-1"
                        disabled={pending}
                        maxLength={2000}
                    />
                    <Button type="submit" size="lg" disabled={pending || !input.trim()}>
                        {pending ? <Loader2 className="animate-spin" /> : <SendHorizontal />} Ask AI
                    </Button>
                </form>
            }
        >
            <div className="min-h-64 space-y-4" aria-live="polite">
                {turns.length === 0 && !pending && (
                    <div className="py-4 text-center">
                        <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-primary/10">
                            <AIMark className="size-5" />
                        </div>
                        <p className="text-sm font-medium text-foreground">Ask about availability, hours, coverage or cost</p>
                        <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
                            The assistant looks up real shifts, availability and time off before answering. It can&apos;t change the schedule — use the Schedule page or the AI Schedule Copilot for that.
                        </p>
                        <div className="mt-4 flex flex-wrap justify-center gap-2">
                            {EXAMPLES.map((q) => (
                                <button
                                    key={q}
                                    onClick={() => void ask(q)}
                                    className="rounded-full border border-border px-3 py-1.5 text-xs text-foreground transition-colors hover:border-primary/40 hover:bg-primary/5"
                                >
                                    {q}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {turns.map((t, i) =>
                    t.role === "user" ? (
                        <div key={i} className="flex justify-end">
                            <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-sm text-primary-foreground">
                                {t.content}
                            </p>
                        </div>
                    ) : (
                        <div key={i} className="flex gap-2.5">
                            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
                                <AIMark className="size-3.5" />
                            </span>
                            <div className="min-w-0 max-w-[85%] space-y-1.5">
                                <p className="whitespace-pre-wrap rounded-2xl rounded-tl-md bg-muted px-3.5 py-2 text-sm text-foreground">
                                    {t.content}
                                </p>
                                <Sources tools={t.tools ?? []} />
                            </div>
                        </div>
                    )
                )}

                {pending && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="size-4 animate-spin text-primary" /> Checking your schedule data…
                    </div>
                )}
                {error && <ErrorState message={error} />}
                <div ref={endRef} />
            </div>
        </Dialog>
    );
}

function Sources({ tools }: { tools: ToolUse[] }) {
    const used = [...new Set(tools.filter((t) => t.ok).map((t) => TOOL_LABELS[t.name] ?? t.name))];
    return (
        <p className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
            <Database className="size-3" />
            {used.length ? (
                <>Based on: {used.join(" · ")}</>
            ) : (
                <>No schedule data was looked up for this answer.</>
            )}
            <span className="ml-1">· AI can make mistakes; check before acting.</span>
        </p>
    );
}
