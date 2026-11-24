import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/messages";
import { useQuery } from "@tanstack/react-query";
import { useOrg } from "@/lib/org-context";
import { executionOptions } from "@/lib/execution";
import type { ExecutionRef } from "@/lib/execution-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { BookOpen, X } from "lucide-react";

export function ExecutionContextPicker({
  value,
  onChange,
  disabled,
}: {
  value: ExecutionRef[];
  onChange: (value: ExecutionRef[]) => void;
  disabled?: boolean;
}) {
  const o = useOrg();
  const { t } = useI18n();
  const query = useQuery(executionOptions(o.org?.id, o.workspace?.id, o.userId));
  const [search, setSearch] = useState("");
  const records = query.data
    ? [
        ...(["projects", "tasks", "campaigns"] as const).flatMap((kind) =>
          query.data[kind].map((r) => ({ kind, id: r.id, title: r.title, detail: r.status })),
        ),
        ...query.data.approvals
          .filter((r) => ["approved", "executed"].includes(r.status))
          .map((r) => ({ kind: "approvals" as const, id: r.id, title: r.title, detail: r.status })),
        ...query.data.events.map((r) => ({
          kind: "activity_events" as const,
          id: r.id,
          title: `${r.entity_type} · ${r.action}`,
          detail: r.created_at.slice(0, 10),
        })),
      ]
    : [];
  const matches = records.filter((r) =>
    `${r.title} ${r.kind}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled}>
          <BookOpen />
          {t("officer.ctx.selected")}
          {value.length ? ` (${value.length}/12)` : ""}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)]">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-semibold">{t("officer.ctx.title")}</p>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("officer.ctx.clear")}
            disabled={!value.length}
            onClick={() => onChange([])}
          >
            <X />
          </Button>
        </div>
        <Input
          aria-label={t("officer.ctx.find")}
          placeholder={t("officer.ctx.findPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {query.isError ? (
          <p role="alert" className="mt-3 text-xs text-destructive">
            {t("officer.ctx.failed")}
            <Button variant="link" onClick={() => query.refetch()}>
              {t("officer.retry")}
            </Button>
          </p>
        ) : query.isLoading ? (
          <p role="status" className="mt-3 text-xs">
            {t("officer.ctx.loading")}
          </p>
        ) : (
          <div className="mt-3 max-h-72 space-y-3 overflow-y-auto">
            {matches.slice(0, 80).map((r) => {
              const checked = value.some((v) => v.kind === r.kind && v.id === r.id);
              return (
                <label
                  key={`${r.kind}:${r.id}`}
                  className="flex cursor-pointer items-start gap-2 text-xs"
                >
                  <Checkbox
                    checked={checked}
                    disabled={disabled || (!checked && value.length >= 12)}
                    onCheckedChange={(next) =>
                      onChange(
                        next
                          ? [...value, { kind: r.kind, id: r.id }]
                          : value.filter((v) => v.id !== r.id || v.kind !== r.kind),
                      )
                    }
                  />
                  <span className="min-w-0 break-words">
                    {r.title}
                    <span className="mt-1 block text-2xs text-muted-foreground">
                      {t(`officer.ctx.kind.${r.kind}` as MessageKey)} · {r.detail}
                    </span>
                  </span>
                </label>
              );
            })}
            {!matches.length && (
              <p className="text-xs text-muted-foreground">{t("officer.ctx.none")}</p>
            )}
            {matches.length > 80 && (
              <p className="text-xs text-muted-foreground">
                {t("officer.ctx.refine", { n: matches.length })}
              </p>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
