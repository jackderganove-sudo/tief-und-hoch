import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Panel, PxButton } from '../components/px';
import { SignInButtons } from '../components/AccountSheet';
import { setThemeColor } from '../pwa/themeColor';
import { adminDb, loadOverview, type Overview } from './adminApi';
import { OverviewTab } from './OverviewTab';
import { ReviewTab } from './ReviewTab';
import { DebugTab } from './DebugTab';
import { QuestionsTab } from './QuestionsTab';
import { PlayersTab } from './PlayersTab';
import { SystemTab } from './SystemTab';
import { RoomsTab } from './RoomsTab';

/**
 * Admin-Dashboard unter /admin (nur über den Button im Profil verlinkt).
 * Zugriff nur für Einträge in der Tabelle admins – jede Abfrage und Aktion prüft
 * das zusätzlich serverseitig (RLS bzw. is_admin() in den admin_*-Funktionen).
 */
export default function AdminApp() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    document.title = 'Highs & Lows – Admin-Dashboard';
    // nie in Suchergebnissen (robots.txt sperrt /admin zusätzlich)
    let robots = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (!robots) {
      robots = document.createElement('meta');
      robots.name = 'robots';
      document.head.appendChild(robots);
    }
    robots.content = 'noindex, nofollow';
    document.querySelector('link[rel="canonical"]')?.remove();
    setThemeColor('#16121f');
    if (!adminDb) return;
    void adminDb.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = adminDb.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!adminDb || !session) return setIsAdmin(null);
    // Nur der eigene Eintrag ist lesbar (RLS) – leer heißt: kein Admin
    void adminDb
      .from('admins')
      .select('user_id')
      .eq('user_id', session.user.id)
      .maybeSingle()
      .then(({ data }) => setIsAdmin(!!data));
  }, [session]);

  const shell = (children: React.ReactNode) => <div className="min-h-dvh bg-[#17121f] px-3 py-4 text-[#ece6f5] sm:px-6">{children}</div>;

  if (!adminDb) return shell(<Panel tone="stone">Supabase ist nicht konfiguriert (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).</Panel>);
  if (session === undefined) return shell(<p className="text-center opacity-70">…</p>);

  if (!session || session.user.is_anonymous) {
    return shell(
      <div className="mx-auto mt-[20vh] max-w-sm">
        <Panel tone="stone" className="px-2 text-center">
          <h1 className="text-3xl font-bold">Admin-Dashboard</h1>
          <p className="mt-2 text-base opacity-80">Nur für eingetragene Admins</p>
          <div className="mt-4">
            <SignInButtons />
          </div>
        </Panel>
      </div>,
    );
  }

  const signOut = () => void adminDb!.auth.signOut();
  const name = (session.user.user_metadata?.user_name as string | undefined) ?? session.user.email ?? session.user.id;

  if (isAdmin === null) return shell(<p className="text-center opacity-70">Prüfe Zugriff …</p>);
  if (!isAdmin) {
    return shell(
      <div className="mx-auto mt-[15vh] max-w-md">
        <Panel tone="stone" className="px-2">
          <h1 className="text-2xl font-bold">Kein Zugriff</h1>
          <p className="mt-2 text-base">Angemeldet als {name}, aber nicht als Admin eingetragen.</p>
          <p className="mt-2 break-all font-tiny text-xs opacity-80">user_id: {session.user.id}</p>
          <PxButton tone="stone" small className="mt-4 text-base" onClick={signOut}>
            Abmelden
          </PxButton>
        </Panel>
      </div>,
    );
  }

  return shell(<Dashboard name={name} userId={session.user.id} onSignOut={signOut} />);
}

// ---------------------------------------------------------------- Dashboard mit Tabs

const TABS = [
  ['overview', '📊 Übersicht'],
  ['review', '🤖 KI-Checker'],
  ['debug', '🛠 Debug'],
  ['questions', '❓ Fragen'],
  ['rooms', '🎲 Räume'],
  ['players', '👥 Spieler'],
  ['system', '⚙ System'],
] as const;
export type TabId = (typeof TABS)[number][0];

function initialTab(): TabId {
  const t = new URLSearchParams(location.search).get('tab');
  return TABS.some(([id]) => id === t) ? (t as TabId) : 'overview';
}

function Dashboard({ name, userId, onSignOut }: { name: string; userId: string; onSignOut: () => void }) {
  const db = adminDb!;
  const [tab, setTabState] = useState<TabId>(initialTab);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  const setTab = (t: TabId) => {
    setTabState(t);
    const u = new URL(location.href);
    u.searchParams.set('tab', t);
    history.replaceState(history.state, '', u);
    window.scrollTo({ top: 0 });
  };

  const refreshOverview = useCallback(() => {
    loadOverview(db)
      .then((o) => {
        setOverview(o);
        setOverviewError(null);
      })
      .catch((e) => setOverviewError(String(e)));
  }, [db]);
  useEffect(() => {
    refreshOverview();
    const id = window.setInterval(refreshOverview, 60_000);
    return () => window.clearInterval(id);
  }, [refreshOverview]);

  const open = overview ? overview.open_pending + overview.open_unchecked : 0;

  return (
    <div className="mx-auto max-w-4xl">
      <header className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold leading-none sm:text-3xl">Admin-Dashboard</h1>
        <div className="flex items-center gap-2 text-sm">
          <span className="hidden opacity-75 sm:inline">{name}</span>
          <a href={import.meta.env.BASE_URL} className="px-btn px-btn-wood px-btn-sm text-base">
            <span className="px-btn-label">Spiel</span>
          </a>
          <PxButton tone="stone" small className="text-base" onClick={onSignOut}>
            Abmelden
          </PxButton>
        </div>
      </header>

      <nav className="sticky top-0 z-30 -mx-3 mt-3 overflow-x-auto bg-[#17121f]/95 px-3 py-2 backdrop-blur sm:-mx-6 sm:px-6" aria-label="Bereiche">
        <div role="tablist" className="flex w-max gap-1.5">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`px-field ${tab === id ? 'px-field-light text-[#3a2416]' : 'px-field-dark'} relative whitespace-nowrap px-2 text-base leading-8 [--px:2px]`}
            >
              {label}
              {id === 'review' && open > 0 && (
                <span className="ml-1.5 inline-block min-w-5 bg-[#e2603a] px-1 text-center text-sm leading-5 text-white" aria-label={`${open} offen`}>
                  {open}
                </span>
              )}
            </button>
          ))}
        </div>
      </nav>

      <main className="mt-2 min-w-0 pb-10">
        {tab === 'overview' && <OverviewTab overview={overview} error={overviewError} onRefresh={refreshOverview} onOpenReview={() => setTab('review')} />}
        {tab === 'review' && <ReviewTab onChanged={refreshOverview} />}
        {tab === 'debug' && <DebugTab />}
        {tab === 'questions' && <QuestionsTab />}
        {tab === 'rooms' && <RoomsTab selfId={userId} onChanged={refreshOverview} />}
        {tab === 'players' && <PlayersTab selfId={userId} onChanged={refreshOverview} />}
        {tab === 'system' && <SystemTab />}
      </main>
    </div>
  );
}

