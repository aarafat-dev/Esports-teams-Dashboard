import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Activity, ArrowRight, Crosshair, FlaskConical, FolderOpen, Plus, X } from 'lucide-react';
import type { Tournament } from './shared/types';
import { Workspace } from './ui/Workspace';
import { api, jsonRequest } from './ui/api';
import './styles.css';
function App() {
  const [tournaments, setTournaments] = useState<Tournament[]>([]), [active, setActive] = useState<string | null>(null), [creating, setCreating] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [config, setConfig] = useState<{ model: string; aiAvailable: boolean } | null>(null);
  const refresh = () => api<Tournament[]>('/tournaments').then(setTournaments).catch(e => setError(e.message));
  useEffect(() => { refresh(); api<{ model: string; aiAvailable: boolean }>('/config').then(setConfig).catch(e => setError(e.message)); }, []);
  const create = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError('');
    const form = new FormData(event.currentTarget);
    try { const t = await api<Tournament>('/tournaments', jsonRequest('POST', { name: form.get('name'), date: form.get('date') || null })); setCreating(false); setActive(t.id); refresh(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return <div className="app-shell"><aside className="sidebar"><div className="brand-mark"><Crosshair size={25}/></div><span className="sidebar-label">FF</span><div className="sidebar-divider"/><div className="nav-icon active" title="Benchmark workspaces"><FolderOpen size={21}/></div><div className="sidebar-bottom"><FlaskConical size={21}/><span>LAB</span></div></aside><div className="main-shell"><header className="topbar"><div className="brand"><strong>FREE FIRE<span> / </span>ANALYTICS</strong><span className="tag">PROTOTYPE</span></div><div className="system-state"><span className={`dot ${config?.aiAvailable ? '' : 'offline'}`}/>{config ? config.aiAvailable ? 'Workers AI connected' : 'Offline development' : 'Connecting…'}</div></header><main>
    {config && !config.aiAvailable && <p className="offline-notice">Offline mode · Upload, review, and benchmarking are available. Live extraction requires <code>npx wrangler login</code> and <code>npm run dev</code>.</p>}
    {active ? <Workspace key={active} id={active} onHome={() => { setActive(null); refresh(); }}/> : <><div className="hero"><p className="eyebrow"><span/> VISION EXTRACTION LAB</p><h1>Free Fire Analytics</h1><p className="hero-subtitle">AI Screenshot Extraction Test</p><p className="hero-description">From match screenshots to measurable accuracy.<br/>Extract the stats. Check every detail. Find out what AI gets right.</p><button className="primary" onClick={() => setCreating(true)}><Plus size={18}/>Create Test Tournament</button><div className="hero-decoration" aria-hidden="true"><Crosshair/><div/><span>VISION / 01</span></div></div>
    <div className="section-heading"><div><h2>Your test workspaces <span className="count">{tournaments.length}</span></h2><p className="muted">Organize screenshots from tournaments and scrims you played elsewhere.</p></div><span className="tag"><FlaskConical size={12}/>BENCHMARK MODE</span></div>
    {error && <p role="alert" className="error">{error}</p>}
    {tournaments.length ? <div className="tournament-grid">{tournaments.map(t => <button className="tournament-card" key={t.id} onClick={() => setActive(t.id)}><div className="folder-icon"><FolderOpen size={24}/></div><strong>{t.name}</strong><span className="muted">{t.date ?? 'No date set'} · {t.screenshotCount ?? 0} screenshots</span><div className="card-link">Open workspace<ArrowRight size={17}/></div></button>)}<button className="new-workspace" onClick={() => setCreating(true)}><Plus size={25}/><span>Create a test workspace</span></button></div> : <div className="welcome-panel"><div className="folder-icon"><FolderOpen size={29}/></div><h3>A clean slate for your first experiment</h3><p>Create a test tournament, then upload real Free Fire result screenshots.<br/>Your AI predictions and human corrections will live here.</p><button onClick={() => setCreating(true)}>Create your first workspace<ArrowRight size={16}/></button></div>}
    <div className="principles"><div><span>01</span><div><h3>Vision, directly</h3><p>The multimodal model reads the screenshot and classifies the result screen.</p></div></div><div><span>02</span><div><h3>Human verified</h3><p>Correct names and numbers beside the original. Keep every AI attempt intact.</p></div></div><div><span>03</span><div><h3>Measured exactly</h3><p>See field accuracy, perfect screenshots, failures, and processing time.</p></div></div></div></>}
    </main><footer><span><Activity size={13}/>Free Fire vision benchmark</span><span>{config?.model ?? 'Loading model configuration…'}</span></footer></div>
    {creating && <div className="modal-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="create-title" className="modal"><div className="section-heading compact"><h2 id="create-title">Create Test Tournament</h2><button aria-label="Close form" onClick={() => setCreating(false)} disabled={busy}><X size={18}/></button></div><p className="muted">A workspace for testing screenshots from your matches.</p><form onSubmit={create}><label>Tournament Name *<input autoFocus name="name" required maxLength={120} placeholder="MENA Scrim Test"/></label><label>Date <span className="muted">(optional)</span><input name="date" type="date"/></label>{error && <p role="alert" className="error">{error}</p>}<button className="primary" disabled={busy}>{busy ? 'Creating…' : 'Create Tournament'}<ArrowRight size={16}/></button></form></section></div>}
  </div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
