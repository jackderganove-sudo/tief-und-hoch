import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { compact } from '../domain/normalize';
import { tierFor } from '../domain/scoring';
import { MODES, TOPICS, type Lang, type Mode, type Question } from '../domain/types';
import { services } from '../services';
import { PxButton } from '../components/px';
import { adminDb, loadQuestionFlags, loadQuestionStats, type AnswerStat, type QuestionFlag } from './adminApi';
import { Card, Chips, ErrorLine, Field } from './ui';

/** Alle Fragen beider Sprachen (inkl. freigegebener Antworten), einmal geladen. */
async function loadAll(): Promise<Question[]> {
  const lists = await Promise.all(
    (['de', 'en'] as Lang[]).flatMap((lang) => MODES.map((mode) => services.questions.getQuestions({ lang, mode, topics: 'all' }))),
  );
  const byId = new Map<string, Question>();
  for (const q of lists.flat()) byId.set(q.id, q);
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

const langOf = (q: Question) => q.id.slice(0, 2);

/** Fragen: Suche, Detail mit echten Spielerzahlen, auffällige Fragen. */
export function QuestionsTab() {
  const { t } = useTranslation();
  const [all, setAll] = useState<Question[] | null>(null);
  const [flags, setFlags] = useState<QuestionFlag[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [lang, setLang] = useState<'all' | Lang>('all');
  const [mode, setMode] = useState<'all' | Mode>('all');
  const [topic, setTopic] = useState<string>('all');
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    void loadAll().then(setAll);
    loadQuestionFlags(adminDb!, 5)
      .then(setFlags)
      .catch((e) => setError(String(e)));
  }, []);

  const results = useMemo(() => {
    if (!all) return [];
    const key = compact(query);
    return all.filter(
      (q) =>
        (lang === 'all' || langOf(q) === lang) &&
        (mode === 'all' || q.modes.includes(mode)) &&
        (topic === 'all' || q.topic === topic) &&
        (!key || compact(`${q.id} ${q.prompt} ${q.topic} ${t(`topics.${q.topic}`, q.topic)}`).includes(key)),
    );
  }, [all, query, lang, mode, topic, t]);

  const byId = useMemo(() => new Map((all ?? []).map((q) => [q.id, q])), [all]);
  const open = openId ? byId.get(openId) : undefined;

  return (
    <div className="grid gap-3">
      <ErrorLine error={error} />
      <Card title="Auffällige Fragen (oft „Daneben“ oder KI-Prüfung)">
        {flags === null ? (
          <p className="text-sm opacity-70">Lade …</p>
        ) : flags.length === 0 ? (
          <p className="text-sm opacity-70">Noch zu wenige Antworten (mind. 5 pro Frage).</p>
        ) : (
          <ul className="grid gap-1">
            {flags.slice(0, 12).map((f) => (
              <li key={f.question_id}>
                <button type="button" onClick={() => setOpenId(f.question_id)} className="w-full text-left text-sm leading-snug hover:underline">
                  <span className="font-tiny text-[0.65rem] opacity-70">{f.question_id}</span> {byId.get(f.question_id)?.prompt ?? ''}
                  <br />
                  <span className={f.miss_rate >= 40 ? 'text-[#e2603a]' : 'opacity-85'}>{f.miss_rate}% daneben</span>
                  <span className="opacity-60"> · </span>
                  <span className={f.ai_rate >= 30 ? 'text-[#f2b53a]' : 'opacity-85'}>{f.ai_rate}% KI</span>
                  <span className="opacity-60"> · {f.plays} Antworten</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1 text-xs opacity-60">Kandidaten für bessere Antwortlisten. Ohne Debug-Runden.</p>
      </Card>

      {open && <QuestionDetail q={open} onClose={() => setOpenId(null)} />}

      <Card title={`Suche · ${all ? `${results.length} von ${all.length}` : '…'}`}>
        <div className="grid gap-2">
          <Field label="Text, Thema oder ID">
            <input value={query} onChange={(e) => setQuery(e.target.value)} className="w-full bg-transparent px-1 text-base" type="search" />
          </Field>
          <Chips label="Sprache" value={lang} onChange={setLang} options={[['all', 'alle'], ['de', 'DE'], ['en', 'EN']]} />
          <Chips label="Modus" value={mode} onChange={setMode} options={[['all', 'alle'], ['rare', '▼'], ['common', '▲']]} />
          <label className="flex items-center gap-2 text-sm">
            <span className="w-16 shrink-0 font-tiny text-xs uppercase opacity-75">Thema</span>
            <select value={topic} onChange={(e) => setTopic(e.target.value)} className="px-field px-field-dark min-w-0 flex-1 bg-transparent px-1 text-base [--px:2px]">
              <option value="all">alle</option>
              {TOPICS.map((x) => (
                <option key={x} value={x}>
                  {t(`topics.${x}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <ul className="mt-2 grid gap-1">
          {results.slice(0, 100).map((q) => (
            <li key={q.id}>
              <button
                type="button"
                onClick={() => setOpenId(q.id)}
                className={`w-full px-1 text-left text-base leading-snug hover:bg-white/5 ${openId === q.id ? 'bg-white/10' : ''}`}
              >
                <span className="font-tiny text-[0.65rem] opacity-70">
                  {q.id} · {q.modes.map((m) => (m === 'rare' ? '▼' : '▲')).join('')} · {q.answers.length} Antw.
                </span>
                <br />
                {q.prompt}
              </button>
            </li>
          ))}
          {results.length > 100 && <li className="text-sm opacity-70">… {results.length - 100} weitere – Suche eingrenzen.</li>}
        </ul>
      </Card>
    </div>
  );
}

function QuestionDetail({ q, onClose }: { q: Question; onClose: () => void }) {
  const { t } = useTranslation();
  const [stats, setStats] = useState<AnswerStat[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setStats(null);
    loadQuestionStats(adminDb!, q.id)
      .then(setStats)
      .catch((e) => setError(String(e)));
  }, [q.id]);

  const total = stats?.reduce((s, a) => s + Number(a.plays), 0) ?? 0;
  const playsOf = (text: string) => stats?.filter((a) => a.answer === text).reduce((s, a) => s + Number(a.plays), 0) ?? 0;
  const known = new Set(q.answers.map((a) => a.text));
  const others = stats?.filter((a) => !known.has(a.answer)) ?? [];
  const answers = [...q.answers].sort((a, b) => b.baseScore - a.baseScore);

  return (
    <Card title={`${q.id} · ${t(`topics.${q.topic}`, q.topic)}`} right={<PxButton tone="stone" small className="text-base" onClick={onClose}>✕</PxButton>}>
      <p className="text-xl font-bold leading-tight">{q.prompt}</p>
      <p className="mt-1 text-sm opacity-75">
        Modi: {q.modes.map((m) => (m === 'rare' ? '▼ Abstieg' : '▲ Aufstieg')).join(', ')} · {total} echte Antworten (Tagesrunden, ohne Übung/Debug)
      </p>
      <ErrorLine error={error} />
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="font-tiny text-[0.6rem] uppercase opacity-70">
            <tr>
              <th className="py-1 pr-2">Antwort</th>
              <th className="py-1 pr-2 text-right">base</th>
              <th className="py-1 pr-2">Stufe</th>
              <th className="py-1 text-right">gegeben</th>
            </tr>
          </thead>
          <tbody>
            {answers.map((a) => {
              const p = playsOf(a.text);
              return (
                <tr key={a.text} className="border-t border-white/10 align-top">
                  <td className="py-1 pr-2">
                    {a.text}
                    {a.approved && <span className="ml-1 text-xs text-[#7ec850]">freigegeben</span>}
                    {a.tooClever && <span className="ml-1 text-xs text-[#f2b53a]">🤓</span>}
                    {a.aliases.length > 0 && <span className="block text-xs opacity-60">{a.aliases.join(', ')}</span>}
                  </td>
                  <td className="py-1 pr-2 text-right tabular-nums">{a.baseScore}</td>
                  <td className="py-1 pr-2 text-xs">
                    {q.modes.map((m) => t(`tiers.${tierFor(m, a.baseScore, a.tooClever)}`)).join(' / ')}
                  </td>
                  <td className="py-1 text-right tabular-nums">
                    {stats ? p : '…'}
                    {stats && total > 0 && p > 0 && <span className="block text-xs opacity-60">{Math.round((100 * p) / total)}%</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {others.length > 0 && (
        <>
          <p className="mt-3 font-tiny text-[0.65rem] uppercase opacity-70">Nicht in der Liste (KI oder daneben)</p>
          <ul className="mt-1 grid gap-0.5 text-sm">
            {others.slice(0, 30).map((a) => (
              <li key={`${a.answer}-${a.source}`} className="flex justify-between gap-2">
                <span className="truncate">
                  {a.answer.replace(/^∅ /, '')} <span className="text-xs opacity-60">{a.answer.startsWith('∅') ? 'daneben' : a.source === 'ai' ? 'KI' : ''}</span>
                </span>
                <span className="tabular-nums">{a.plays}×</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
