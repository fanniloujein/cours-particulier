"use client";
import { useMemo, useState } from "react";
import { CalendarCheck, CheckCircle2, Clock, FileDown, RotateCcw, Search, Users } from "lucide-react";
import { api, cn, fullName, qsOf, refreshAll, useApi } from "@/lib/client";
import { addMonths, dayName, duration, endOfMonth, formatMinutes, monthLabel, monthOf, shortDate, today } from "@/lib/dates";
import { formatDT } from "@/lib/money";
import type { Session } from "@/lib/types";
import { Badge, Button, Empty, ErrorBox, Input, Loading, PageHeader, Segmented, Select, Tabs, useToast } from "@/components/ui";
import { SubjectDot, useRefs } from "@/components/shared";
import { SessionDetail } from "@/components/SessionDetail";

type Period = "all" | "month" | "prev" | "year" | "custom";
const who = (s: Session) => s.title || s.participants.map((p) => fullName(p.student)).join(", ");
const NO_SUBJECT = "__none";

export default function DoneSessionsPage() {
  const refs = useRefs();
  const toast = useToast();
  const t = today();
  const [period, setPeriod] = useState<Period>("all");
  const [custom, setCustom] = useState({ from: `${monthOf(t)}-01`, to: endOfMonth(t) });
  const [studentId, setStudent] = useState("");
  const [subject, setSubject] = useState<string>("");
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"done" | "todo">("done");
  const [sel, setSel] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const range =
    period === "month" ? { from: `${monthOf(t)}-01`, to: endOfMonth(t) }
    : period === "prev" ? { from: `${addMonths(monthOf(t), -1)}-01`, to: endOfMonth(`${addMonths(monthOf(t), -1)}-01`) }
    : period === "year" ? { from: `${t.slice(0, 4)}-01-01`, to: `${t.slice(0, 4)}-12-31` }
    : period === "custom" ? custom
    : { from: "", to: "" };
  const base = { from: range.from, to: range.to, studentId, take: 1000 };
  const done = useApi<{ items: Session[]; total: number }>(`/api/sessions${qsOf({ ...base, status: "DONE", order: "desc" })}`);
  const todo = useApi<{ items: Session[]; total: number }>(`/api/sessions${qsOf({ ...base, status: "PLANNED" })}`);

  const match = (s: Session) =>
    (!subject || (subject === NO_SUBJECT ? !s.subjectId : s.subjectId === subject)) &&
    (!q || `${who(s)} ${s.chapter ?? ""} ${s.report ?? ""}`.toLowerCase().includes(q.toLowerCase()));

  // Récapitulatif par matière (séances effectuées sur la période)
  const bySubject = useMemo(() => {
    const m = new Map<string, { id: string; name: string; color: string; count: number; minutes: number; students: Set<string>; todo: number }>();
    const get = (s: Session) => {
      const id = s.subjectId ?? NO_SUBJECT;
      if (!m.has(id)) m.set(id, { id, name: s.subject?.name ?? "Sans matière", color: s.subject?.color ?? "#cfd6e4", count: 0, minutes: 0, students: new Set(), todo: 0 });
      return m.get(id)!;
    };
    for (const s of done.data?.items ?? []) {
      const g = get(s);
      g.count++;
      g.minutes += duration(s.startTime, s.endTime);
      s.participants.forEach((p) => g.students.add(p.studentId));
    }
    for (const s of todo.data?.items ?? []) get(s).todo++;
    return [...m.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [done.data, todo.data]);

  const doneList = (done.data?.items ?? []).filter(match);
  const todoList = (todo.data?.items ?? []).filter(match);
  const late = todoList.filter((s) => s.date < t || (s.date === t && s.endTime <= new Date().toTimeString().slice(0, 5)));
  const byMonth = useMemo(() => {
    const m = new Map<string, Session[]>();
    for (const s of doneList) m.set(monthOf(s.date), [...(m.get(monthOf(s.date)) ?? []), s]);
    return [...m.entries()];
  }, [doneList]);
  const totalMin = doneList.reduce((a, s) => a + duration(s.startTime, s.endTime), 0);

  const setStatus = async (ids: string[], status: "DONE" | "PLANNED") => {
    if (!ids.length) return;
    setBusy(true);
    try {
      await api("/api/sessions/bulk", { body: { ids, action: "status", status } });
      toast.success(status === "DONE" ? `${ids.length} séance(s) marquée(s) effectuée(s) : facturation et suivi mis à jour.` : "Séance remise en « prévue » (facture annulée avec trace).");
      setSel([]);
      await Promise.all([done.mutate(), todo.mutate()]);
      refreshAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(false);
    }
  };

  const error = done.error || todo.error;
  return (
    <div className="space-y-5">
      <PageHeader
        title="Séances effectuées"
        icon={<CalendarCheck className="h-5 w-5" />}
        subtitle="Pointez les séances faites et retrouvez-les par matière, dans le passé comme à l'avance."
        actions={
          <a href={`/api/export${qsOf({ dataset: "sessions", format: "xlsx", status: "DONE", from: range.from, to: range.to, studentId, subjectId: subject && subject !== NO_SUBJECT ? subject : "" })}`}>
            <Button variant="secondary"><FileDown className="h-4 w-4" />Excel</Button>
          </a>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Segmented value={period} onChange={setPeriod} options={[{ value: "all", label: "Tout" }, { value: "month", label: "Ce mois" }, { value: "prev", label: "Mois dernier" }, { value: "year", label: "Cette année" }, { value: "custom", label: "Période…" }]} />
        {period === "custom" && (
          <>
            <Input type="date" className="w-auto" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} aria-label="Du" />
            <Input type="date" className="w-auto" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} aria-label="Au" />
          </>
        )}
        <Select className="w-auto" value={studentId} onChange={(e) => setStudent(e.target.value)} options={refs.students.map((s) => ({ value: s.id, label: fullName(s) }))} placeholder="Tous les élèves" />
        <div className="relative min-w-[180px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Élève, chapitre, compte rendu…" />
        </div>
      </div>

      {/* Matières */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <button onClick={() => setSubject("")} className={cn("card p-3 text-left transition hover:-translate-y-0.5", !subject && "ring-2 ring-primary-strong")}>
          <div className="text-xs text-muted">Toutes les matières</div>
          <div className="font-display text-xl font-semibold">{done.data?.items.length ?? "…"}</div>
          <div className="text-xs text-muted">séance(s) effectuée(s)</div>
        </button>
        {bySubject.map((g) => (
          <button key={g.id} onClick={() => setSubject(subject === g.id ? "" : g.id)} className={cn("card p-3 text-left transition hover:-translate-y-0.5", subject === g.id && "ring-2 ring-primary-strong")} style={{ borderLeft: `5px solid ${g.color}` }}>
            <div className="truncate text-xs font-medium text-ink-2">{g.name}</div>
            <div className="font-display text-xl font-semibold">{g.count}</div>
            <div className="text-xs text-muted">{formatMinutes(g.minutes)} · {g.students.size} élève(s){g.todo ? ` · ${g.todo} à pointer` : ""}</div>
          </button>
        ))}
      </div>

      {error ? <ErrorBox error={error} retry={() => { done.mutate(); todo.mutate(); }} /> : !done.data || !todo.data ? <Loading rows={6} /> : (
        <div className="card p-4 sm:p-5">
          <Tabs
            tabs={[{ value: "done", label: "Effectuées", count: doneList.length }, { value: "todo", label: "À marquer", count: todoList.length }]}
            value={tab}
            onChange={(v) => { setTab(v); setSel([]); }}
          />

          {tab === "done" ? (
            doneList.length === 0 ? <Empty icon={<CheckCircle2 className="h-6 w-6" />} title="Aucune séance effectuée pour ces filtres" /> : (
              <div className="space-y-5">
                <div className="flex flex-wrap gap-4 text-sm text-muted">
                  <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-success" /><b className="text-ink">{doneList.length}</b> séance(s)</span>
                  <span className="inline-flex items-center gap-1.5"><Clock className="h-4 w-4" /><b className="text-ink">{formatMinutes(totalMin)}</b> de cours</span>
                  <span className="inline-flex items-center gap-1.5"><Users className="h-4 w-4" /><b className="text-ink">{new Set(doneList.flatMap((s) => s.participants.map((p) => p.studentId))).size}</b> élève(s)</span>
                </div>
                {byMonth.map(([m, list]) => (
                  <section key={m}>
                    <h3 className="section-title mb-2">{monthLabel(m)} <span className="text-sm font-normal text-muted">· {list.length} séance(s)</span></h3>
                    <ul className="space-y-1.5">
                      {list.map((s) => (
                        <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-line px-3 py-2 hover:bg-surface-2/50">
                          <button onClick={() => setOpen(s.id)} className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-left">
                            <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                            <span className="w-32 text-sm"><span className="capitalize text-muted">{dayName(s.date).slice(0, 3)}.</span> {shortDate(s.date)}</span>
                            <span className="w-24 text-sm tabular-nums text-muted">{s.startTime}–{s.endTime}</span>
                            <span className="inline-flex items-center gap-1.5 text-sm"><SubjectDot color={s.subject?.color} />{s.subject?.name ?? "Sans matière"}</span>
                            <span className="min-w-0 flex-1 truncate text-sm font-medium">{who(s)}</span>
                            {s.chapter && <span className="max-w-[220px] truncate text-xs text-muted">{s.chapter}</span>}
                            {s.date > t && <Badge tone="accent">pointée à l&apos;avance</Badge>}
                          </button>
                          <span className="text-xs tabular-nums text-muted">{formatDT(s.participants.reduce((a, p) => a + Number(p.price), 0))}</span>
                          <Button size="icon-sm" variant="ghost" title="Remettre en « prévue »" disabled={busy} onClick={() => setStatus([s.id], "PLANNED")}><RotateCcw className="h-4 w-4" /></Button>
                          {s.report && <p className="w-full pl-7 text-xs text-ink-2">📝 {s.report}</p>}
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )
          ) : todoList.length === 0 ? <Empty icon={<CalendarCheck className="h-6 w-6" />} title="Aucune séance à pointer" /> : (
            <div>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Button size="sm" variant="secondary" onClick={() => setSel(sel.length === todoList.length ? [] : todoList.map((s) => s.id))}>{sel.length === todoList.length ? "Tout décocher" : "Tout cocher"}</Button>
                {late.length > 0 && <Button size="sm" variant="ghost" onClick={() => setSel(late.map((s) => s.id))}>Cocher les {late.length} séance(s) passée(s)</Button>}
                <Button size="sm" variant="success" disabled={!sel.length} loading={busy} onClick={() => setStatus(sel, "DONE")}><CheckCircle2 className="h-4 w-4" />Marquer effectuée(s) ({sel.length})</Button>
                <span className="text-xs text-muted">Les séances effectuées sont facturées automatiquement selon le mode de l&apos;élève.</span>
              </div>
              <ul className="space-y-1.5">
                {todoList.map((s) => {
                  const past = late.includes(s);
                  return (
                    <li key={s.id} className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border px-3 py-2", past ? "border-warning/40 bg-warning-soft/30" : "border-line")}>
                      <input type="checkbox" checked={sel.includes(s.id)} onChange={(e) => setSel(e.target.checked ? [...sel, s.id] : sel.filter((x) => x !== s.id))} aria-label="Sélectionner" className="h-4 w-4" />
                      <button onClick={() => setOpen(s.id)} className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-left">
                        <span className="w-32 text-sm"><span className="capitalize text-muted">{dayName(s.date).slice(0, 3)}.</span> {shortDate(s.date)}</span>
                        <span className="w-24 text-sm tabular-nums text-muted">{s.startTime}–{s.endTime}</span>
                        <span className="inline-flex items-center gap-1.5 text-sm"><SubjectDot color={s.subject?.color} />{s.subject?.name ?? "Sans matière"}</span>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{who(s)}</span>
                        {past ? <Badge tone="warning">passée, non pointée</Badge> : <Badge tone="info">à venir</Badge>}
                      </button>
                      <Button size="sm" variant="soft" disabled={busy} onClick={() => setStatus([s.id], "DONE")}><CheckCircle2 className="h-4 w-4" />Effectuée</Button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}
      <SessionDetail id={open} onClose={() => { setOpen(null); done.mutate(); todo.mutate(); }} />
    </div>
  );
}
