import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { compact } from '../domain/normalize';
import { TOPICS, type Lang, type Question } from '../domain/types';
import { LocalQuestionRepository } from '../services/QuestionRepository';
import { Panel, PxButton } from '../components/px';
import { adminDb, approve, defaults, loadVerdicts, recheck, reject, reset, type AdminVerdict, type VerdictFilter } from './adminApi';
import { Chips, ConfirmButton, Field } from './ui';

// ---------------------------------------------------------------- Prüfliste

const repo = new LocalQuestionRepository();

/** KI-Checker: KI-Urteile prüfen (pending/unchecked/approved/rejected), Bulk, Tastenkürzel. */
export function ReviewTab({ onChanged }: { onChanged: () => void }) {
  const { t } = useTranslation();
  const db = adminDb!;
  const [filter, setFilter] = useState<VerdictFilter>({ status: 'pending', ai: 'all', lang: 'all', topic: 'all' });
  const [rows, setRows] = useState<AdminVerdict[] | null>(null);
  const [questions, setQuestions] = useState<Map<string, Question>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focus, setFocus] = useState(0);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const data = await loadVerdicts(db, filter);
      const byLang = new Map<Lang, string[]>();
      for (const v of data) if (v.lang === 'de' || v.lang === 'en') byLang.set(v.lang, [...(byLang.get(v.lang) ?? []), v.question_id]);
      const qs = (await Promise.all([...byLang].map(([lang, ids]) => repo.getQuestionsByIds([...new Set(ids)], lang)))).flat();
      setQuestions(new Map(qs.map((q) => [q.id, q])));
      setRows(data);
      setSelected((s) => new Set([...s].filter((id) => data.some((v) => v.id === id))));
    } catch (e) {
      setError(String(e));
    }
  }, [db, filter]);

  useEffect(() => {
    setRows(null);
    void refresh();
  }, [refresh]);

  const run = useCallback(
    async (action: () => Promise<unknown>) => {
      setBusy(true);
      try {
        await action();
        await refresh();
        onChanged();
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [refresh, onChanged],
  );

  const quickApprove = useCallback((vs: AdminVerdict[]) => run(() => Promise.all(vs.map((v) => approve(db, v, defaults(v))))), [db, run]);
  const quickReject = useCallback((vs: AdminVerdict[]) => run(() => reject(db, vs.map((v) => v.id))), [db, run]);
  // Nacheinander nachprüfen (schont das Kontingent), mit Fortschritt
  const recheckAll = useCallback(
    (vs: AdminVerdict[]) =>
      run(async () => {
        const count: Record<string, number> = {};
        for (let i = 0; i < vs.length; i++) {
          setProgress(`KI prüft ${i + 1}/${vs.length} …`);
          const st = await recheck(db, vs[i]).catch(() => 'error');
          count[st] = (count[st] ?? 0) + 1;
        }
        setProgress(`Fertig: ${Object.entries(count).map(([k, n]) => `${n}× ${k}`).join(', ')}`);
      }),
    [db, run],
  );

  // Gruppiert nach Frage, Reihenfolge = Tastatur-Reihenfolge
  const groups = useMemo(() => {
    const m = new Map<string, AdminVerdict[]>();
    for (const v of rows ?? []) m.set(v.question_id, [...(m.get(v.question_id) ?? []), v]);
    return [...m];
  }, [rows]);
  const flat = useMemo(() => groups.flatMap(([, vs]) => vs), [groups]);

  // Tastenkürzel: ↑/↓ (oder J/K) wählen, A freigeben, R ablehnen, X markieren
  const flatRef = useRef(flat);
  flatRef.current = flat;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey || busy) return;
      const list = flatRef.current;
      const cur = list[focus];
      const key = e.key.toLowerCase();
      if (key === 'arrowdown' || key === 'j') setFocus((f) => Math.min(list.length - 1, f + 1));
      else if (key === 'arrowup' || key === 'k') setFocus((f) => Math.max(0, f - 1));
      else if (key === 'a' && cur) void quickApprove(selected.size ? list.filter((v) => selected.has(v.id)) : [cur]);
      else if (key === 'r' && cur) {
        const vs = selected.size ? list.filter((v) => selected.has(v.id)) : [cur];
        // Bulk-Ablehnen nur mit Bestätigung
        if (vs.length > 1 && !window.confirm(`${vs.length} Antworten ablehnen?`)) return;
        void quickReject(vs);
      }
      else if (key === 'x' && cur) setSelected((s) => toggle(s, cur.id));
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focus, selected, busy, quickApprove, quickReject]);

  useEffect(() => {
    document.querySelector(`[data-idx="${focus}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [focus]);

  const chosen = flat.filter((v) => selected.has(v.id));

  return (
    <div className="pb-28">
      <Panel tone="stone" className="mt-3 px-1">
        <div className="grid gap-2 sm:grid-cols-2">
          <Chips label="Status" value={filter.status} onChange={(status) => setFilter({ ...filter, status })} options={[['pending', 'offen'], ['unchecked', 'nicht geprüft'], ['approved', 'freigegeben'], ['rejected', 'abgelehnt'], ['all', 'alle']]} />
          <Chips label="KI-Urteil" value={filter.ai} onChange={(ai) => setFilter({ ...filter, ai })} options={[['all', 'alle'], ['valid', 'gültig'], ['invalid', 'von KI abgelehnt']]} />
          <Chips label="Sprache" value={filter.lang} onChange={(lang) => setFilter({ ...filter, lang })} options={[['all', 'alle'], ['de', 'DE'], ['en', 'EN']]} />
          <label className="flex items-center gap-2 text-sm">
            <span className="w-16 shrink-0 font-tiny text-xs uppercase opacity-75">Thema</span>
            <select
              value={filter.topic}
              onChange={(e) => setFilter({ ...filter, topic: e.target.value })}
              className="px-field px-field-dark min-w-0 flex-1 bg-transparent px-1 text-base [--px:2px]"
            >
              <option value="all">alle</option>
              {TOPICS.map((topic) => (
                <option key={topic} value={topic}>
                  {t(`topics.${topic}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="mt-2 hidden font-tiny text-[0.65rem] uppercase opacity-60 sm:block">Tasten: ↑ ↓ wählen · A freigeben · R ablehnen · X markieren</p>
      </Panel>

      {error && <p className="mt-3 border-2 border-[#e2541e] bg-[#3a1a14] p-2 text-sm">{error}</p>}
      {progress && <p className="mt-3 text-sm opacity-85">{progress}</p>}
      {filter.status === 'unchecked' && flat.length > 0 && (
        <PxButton tone="gold" small disabled={busy} className="mt-3 text-base" onClick={() => void recheckAll(flat)}>
          🤖 Alle {flat.length} jetzt mit KI prüfen
        </PxButton>
      )}
      {rows === null && !error && <p className="mt-6 text-center opacity-70">Lade …</p>}
      {rows?.length === 0 && <p className="mt-6 text-center opacity-70">Nichts zu prüfen.</p>}

      {groups.map(([qid, vs]) => {
        const q = questions.get(qid);
        return (
          <section key={qid} className="mt-4">
            <h2 className="flex flex-wrap items-baseline gap-x-2 px-1 leading-tight">
              <span className="text-xl font-bold">{q?.prompt ?? qid}</span>
              <span className="font-tiny text-[0.65rem] uppercase opacity-60">
                {qid} · {vs[0].lang.toUpperCase()} · {t(`topics.${vs[0].topic}`, vs[0].topic)}
              </span>
            </h2>
            {vs.map((v) => {
              const idx = flat.indexOf(v);
              return (
                <VerdictCard
                  key={v.id}
                  v={v}
                  question={q}
                  idx={idx}
                  focused={idx === focus}
                  selected={selected.has(v.id)}
                  busy={busy}
                  onFocus={() => setFocus(idx)}
                  onSelect={() => setSelected((s) => toggle(s, v.id))}
                  onApprove={(opts) => run(() => approve(db, v, opts))}
                  onReject={() => quickReject([v])}
                  onReset={() => run(() => reset(db, [v.id]))}
                  onRecheck={() => void recheckAll([v])}
                />
              );
            })}
          </section>
        );
      })}

      {chosen.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <Panel tone="stone" className="mx-auto flex max-w-4xl flex-wrap items-center gap-2 px-1">
            <span className="mr-auto text-base">{chosen.length} markiert</span>
            <PxButton tone="teal" small disabled={busy} className="text-base" onClick={() => void quickApprove(chosen)}>
              ✓ Freigeben
            </PxButton>
            {chosen.length > 1 ? (
              <ConfirmButton tone="coral" disabled={busy} confirmLabel={`${chosen.length} wirklich ablehnen?`} onConfirm={() => void quickReject(chosen)}>
                ✗ Ablehnen
              </ConfirmButton>
            ) : (
              <PxButton tone="coral" small disabled={busy} className="text-base" onClick={() => void quickReject(chosen)}>
                ✗ Ablehnen
              </PxButton>
            )}
            <PxButton tone="stone" small className="text-base" onClick={() => setSelected(new Set())}>
              Aufheben
            </PxButton>
          </Panel>
        </div>
      )}
    </div>
  );
}

function toggle(s: Set<string>, id: string) {
  const n = new Set(s);
  if (n.has(id)) n.delete(id);
  else n.add(id);
  return n;
}

// ---------------------------------------------------------------- Karte pro Urteil

const STATUS_STYLE = {
  unchecked: ['nicht geprüft', '#9aa3b5'],
  pending: ['offen', '#f2b53a'],
  approved: ['freigegeben', '#7ec850'],
  rejected: ['abgelehnt', '#e2603a'],
} as const;

function VerdictCard({
  v,
  question,
  idx,
  focused,
  selected,
  busy,
  onFocus,
  onSelect,
  onApprove,
  onReject,
  onReset,
  onRecheck,
}: {
  v: AdminVerdict;
  question: Question | undefined;
  idx: number;
  focused: boolean;
  selected: boolean;
  busy: boolean;
  onFocus: () => void;
  onSelect: () => void;
  onApprove: (opts: { text: string; aliases: string[]; baseScore: number; mergedInto?: string | null }) => void;
  onReject: () => void;
  onReset: () => void;
  onRecheck: () => void;
}) {
  const [mode, setMode] = useState<'none' | 'approve' | 'merge'>('none');
  const d = defaults(v);
  const [text, setText] = useState(d.text);
  const [aliases, setAliases] = useState(d.aliases.join(', '));
  const [score, setScore] = useState(d.baseScore);
  const [search, setSearch] = useState(v.list_answer ?? '');
  const [label, color] = STATUS_STYLE[v.review_status];

  const matches = useMemo(() => {
    const key = compact(search);
    const answers = question?.answers ?? [];
    return (key ? answers.filter((a) => [a.text, ...a.aliases].some((s) => compact(s).includes(key))) : answers).slice(0, 8);
  }, [search, question]);

  const parsedAliases = aliases
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return (
    <div data-idx={idx} onClick={onFocus} className={`mt-2 ${focused ? 'outline-2 outline-offset-2 outline-[#8be9fd]' : ''}`}>
      <Panel tone="stone" className="px-1">
        <div className="flex items-start gap-2">
          <label className="mt-1 grid size-6 shrink-0 cursor-pointer place-items-center px-field px-field-dark [--px:2px]" aria-label="markieren">
            <input type="checkbox" checked={selected} onChange={onSelect} className="peer sr-only" />
            <span className="hidden size-3 bg-[#8be9fd] peer-checked:block" />
          </label>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-xl font-bold">„{v.raw_answer ?? v.normalized_answer}“</span>
              {v.canonical_text && v.canonical_text !== v.raw_answer && <span className="text-base opacity-80">→ {v.canonical_text}</span>}
              {v.list_answer && <span className="text-sm opacity-80">(Variante von „{v.list_answer}“)</span>}
            </div>
            <p className="mt-1 text-sm leading-snug">
              {v.review_status === 'unchecked' ? (
                <span style={{ color: '#9aa3b5' }}>KI: nicht geprüft – {v.unchecked_reason === 'limited' ? 'Limit erreicht' : 'Fehler/Zeitüberschreitung'}</span>
              ) : (
                <>
                  <span style={{ color: v.ai_valid ? '#7ec850' : '#e2603a' }}>KI: {v.ai_valid ? 'gültig' : 'abgelehnt'}</span>
                  {v.reason && <span className="opacity-80"> – {v.reason}</span>}
                </>
              )}
            </p>
            <p className="mt-1 font-tiny text-[0.65rem] uppercase leading-relaxed opacity-70">
              <span style={{ color }}>{label}</span> · Score {v.estimated_base_score ?? '–'} · {v.plays}× gespielt{v.practice_plays ? ` (${v.practice_plays}× Übung)` : ''} · {new Date(v.created_at).toLocaleDateString('de-DE')} · {v.model}
            </p>
            {v.review_status === 'approved' && v.approved_text && (
              <p className="mt-1 text-sm">
                Freigegeben als „{v.approved_text}“{v.approved_merged_into ? ` → Variante von „${v.approved_merged_into}“` : ` · Score ${v.approved_base_score}`}
                {v.approved_aliases?.length ? ` · Aliase: ${v.approved_aliases.join(', ')}` : ''}
              </p>
            )}
          </div>
        </div>

        <div className="mt-2 flex flex-wrap gap-1">
          {v.review_status === 'unchecked' && (
            <PxButton tone="gold" small disabled={busy} className="text-base" onClick={onRecheck}>
              🤖 Jetzt mit KI prüfen
            </PxButton>
          )}
          <PxButton tone="teal" small disabled={busy} className="text-base" onClick={() => setMode(mode === 'approve' ? 'none' : 'approve')}>
            ✓ Freigeben
          </PxButton>
          <PxButton tone="gold" small disabled={busy} className="text-base" onClick={() => setMode(mode === 'merge' ? 'none' : 'merge')}>
            ⛓ Variante
          </PxButton>
          <PxButton tone="coral" small disabled={busy} className="text-base" onClick={onReject}>
            ✗ Ablehnen
          </PxButton>
          {v.review_status !== 'pending' && (
            <PxButton tone="stone" small disabled={busy} className="text-base" onClick={onReset}>
              ↺ Offen
            </PxButton>
          )}
        </div>

        {mode === 'approve' && (
          <form
            className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_6rem_auto] sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              onApprove({ text: text.trim(), aliases: parsedAliases, baseScore: score });
              setMode('none');
            }}
          >
            <Field label="Schreibweise">
              <input value={text} onChange={(e) => setText(e.target.value)} required maxLength={80} className="w-full bg-transparent px-1 text-base" />
            </Field>
            <Field label="Aliase (Komma)">
              <input value={aliases} onChange={(e) => setAliases(e.target.value)} className="w-full bg-transparent px-1 text-base" />
            </Field>
            <Field label="baseScore">
              <input type="number" min={0} max={100} value={score} onChange={(e) => setScore(Number(e.target.value))} className="w-full bg-transparent px-1 text-base tabular-nums" />
            </Field>
            <PxButton tone="teal" small type="submit" disabled={busy || !text.trim()} className="text-base">
              Speichern
            </PxButton>
          </form>
        )}

        {mode === 'merge' && (
          <div className="mt-2">
            <Field label="Listen-Antwort suchen">
              <input value={search} onChange={(e) => setSearch(e.target.value)} autoFocus className="w-full bg-transparent px-1 text-base" />
            </Field>
            <ul className="mt-1 grid gap-1 sm:grid-cols-2">
              {matches.map((a) => (
                <li key={a.text}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      onApprove({ text: d.text, aliases: d.aliases, baseScore: a.baseScore, mergedInto: a.text });
                      setMode('none');
                    }}
                    className="px-field px-field-dark w-full px-1 text-left text-base [--px:2px]"
                  >
                    {a.text} <span className="text-sm opacity-60">({a.baseScore})</span>
                  </button>
                </li>
              ))}
              {matches.length === 0 && <li className="text-sm opacity-70">Keine passende Listen-Antwort.</li>}
            </ul>
          </div>
        )}
      </Panel>
    </div>
  );
}

