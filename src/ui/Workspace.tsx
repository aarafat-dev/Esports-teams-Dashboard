import { useEffect, useRef, useState } from 'react';
import { BarChart3, CheckCircle2, ChevronRight, FileImage, ImagePlus, LoaderCircle, Play, Upload, X } from 'lucide-react';
import type { Screenshot, Workspace as WorkspaceData } from '../shared/types';
import { benchmark } from '../benchmark/accuracy';
import { api, percent } from './api';
import { Review } from './Review';
import { Results } from './Results';

type Staged = { id: string; file: File; preview: string; error?: string };
export function Workspace({ id, onHome }: { id: string; onHome: () => void }) {
  const [data, setData] = useState<WorkspaceData | null>(null), [error, setError] = useState(''), [tab, setTab] = useState<'screenshots' | 'results'>('screenshots');
  const [staged, setStaged] = useState<Staged[]>([]), [busy, setBusy] = useState(false), [progress, setProgress] = useState({ total: 0, completed: 0, label: '' });
  const [active, setActive] = useState<string | null>(null), [filter, setFilter] = useState('ALL');
  const picker = useRef<HTMLInputElement>(null), previews = useRef(new Set<string>());
  const refresh = async () => { const value = await api<WorkspaceData>(`/tournaments/${id}`); setData(value); return value; };
  useEffect(() => { api<WorkspaceData>(`/tournaments/${id}`).then(setData).catch(e => setError(e.message)); }, [id]);
  useEffect(() => { const urls = previews.current; return () => urls.forEach(URL.revokeObjectURL); }, []);
  useEffect(() => { const leave = (e: BeforeUnloadEvent) => { if (busy) e.preventDefault(); }; window.addEventListener('beforeunload', leave); return () => window.removeEventListener('beforeunload', leave); }, [busy]);
  const hasProcessing = data?.screenshots.some(s => s.status === 'PROCESSING');
  useEffect(() => {
    if (!hasProcessing || busy) return;
    const timer = setInterval(() => { api<WorkspaceData>(`/tournaments/${id}`).then(setData).catch(e => setError(e.message)); }, 5000);
    return () => clearInterval(timer);
  }, [hasProcessing, busy, id]);
  const update = (shot: Screenshot) => setData(old => old ? { ...old, screenshots: old.screenshots.some(s => s.id === shot.id) ? old.screenshots.map(s => s.id === shot.id ? shot : s) : [...old.screenshots, shot] } : old);
  const stage = (files: FileList | File[]) => {
    const incoming = Array.from(files);
    if (incoming.length + staged.length > 100) { setError('Select up to 100 screenshots per batch.'); return; }
    setError('');
    setStaged(old => [...old, ...incoming.map(file => {
      const valid = ['image/png', 'image/jpeg'].includes(file.type) && /\.(png|jpe?g)$/i.test(file.name) && file.size > 0 && file.size <= 8 * 1024 * 1024;
      const preview = valid ? URL.createObjectURL(file) : ''; if (preview) previews.current.add(preview);
      return { id: crypto.randomUUID(), file, preview, error: valid ? undefined : 'Use PNG or JPEG, up to 8 MB.' };
    })]);
  };
  const remove = (item: Staged) => { URL.revokeObjectURL(item.preview); previews.current.delete(item.preview); setStaged(old => old.filter(s => s.id !== item.id)); };
  // This serial runner limits inference pressure. Each request is an independent
  // job boundary that can move to a server queue later without changing providers.
  const run = async (includeUploads: boolean) => {
    if (!data || busy) return;
    setBusy(true); setError('');
    const uploads = includeUploads ? staged.filter(s => !s.error) : [];
    const existing = data.screenshots.filter(s => s.status === 'UPLOADED');
    const jobs: ({ upload: Staged } | { shot: Screenshot })[] = [...existing.map(shot => ({ shot })), ...uploads.map(upload => ({ upload }))];
    setProgress({ total: jobs.length, completed: 0, label: 'Preparing screenshots' });
    let failures = 0;
    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      try {
        let shot: Screenshot;
        if ('upload' in job) {
          setProgress(p => ({ ...p, label: `Uploading ${job.upload.file.name}` }));
          const form = new FormData(); form.append('file', job.upload.file);
          shot = await api<Screenshot>(`/tournaments/${id}/screenshots`, { method: 'POST', body: form });
          update(shot); remove(job.upload);
        } else shot = job.shot;
        setProgress(p => ({ ...p, label: `Analyzing ${shot.filename}` }));
        update({ ...shot, status: 'PROCESSING' });
        const analyzed = await api<Screenshot>(`/screenshots/${shot.id}/analyze`, { method: 'POST' });
        update(analyzed); if (analyzed.attempts.at(-1)?.status === 'FAILED') failures++;
      } catch (e) {
        failures++; const message = (e as Error).message;
        if ('upload' in job) setStaged(old => old.map(s => s.id === job.upload.id ? { ...s, error: message } : s));
        setError(message);
      } finally { setProgress(p => ({ ...p, completed: i + 1 })); }
    }
    try { await refresh(); } catch (e) { setError((e as Error).message); }
    setProgress(p => ({ ...p, label: failures ? `Batch finished · ${failures} failed. Review or retry individual screenshots.` : 'Batch finished · Ready for review' }));
    setBusy(false);
  };
  if (!data) return <div className="empty">{error ? <p className="error">{error}</p> : <><LoaderCircle className="spin"/><p>Loading workspace…</p></>}</div>;
  const screenshots = data.screenshots, selected = screenshots.find(s => s.id === active), selectedIndex = screenshots.findIndex(s => s.id === active);
  if (selected) return <Review key={selected.id} shot={selected} onUpdate={update} onBack={() => setActive(null)} position={`${selectedIndex + 1} / ${screenshots.length}`} onPrevious={selectedIndex > 0 ? () => setActive(screenshots[selectedIndex - 1].id) : undefined} onNext={selectedIndex < screenshots.length - 1 ? () => setActive(screenshots[selectedIndex + 1].id) : undefined}/>;
  const score = benchmark(screenshots), count = (status: string) => screenshots.filter(s => s.status === status).length;
  const processed = screenshots.filter(s => s.attempts.some(a => a.status !== 'PROCESSING')).length;
  const validUploads = staged.filter(s => !s.error).length, queued = count('UPLOADED');
  return <>
    <button className="breadcrumb" disabled={busy} onClick={onHome}>Workspaces<ChevronRight size={14}/><span>{data.tournament.name}</span></button>
    <div className="section-heading"><div><p className="eyebrow">TEST TOURNAMENT</p><h1>{data.tournament.name}</h1><p className="muted">{data.tournament.date ? `${data.tournament.date} · ` : ''}A private workspace for your screenshot experiment.</p></div><button className="primary" disabled={busy} onClick={() => { setTab('screenshots'); picker.current?.click(); }}><Upload size={17}/>Upload Screenshots</button></div>
    <div className="metrics-grid workspace-metrics">{[['Screenshots', screenshots.length], ['Processed', processed], ['Needs review', count('NEEDS_REVIEW')], ['Failed', screenshots.filter(s => s.attempts.at(-1)?.status === 'FAILED').length], ['Perfect accuracy', percent(score.perfectRate)]].map(([label, value]) => <div className="metric" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
    <nav className="tabs" aria-label="Workspace pages"><button className={tab === 'screenshots' ? 'selected' : ''} onClick={() => setTab('screenshots')}><FileImage size={16}/>Screenshots<span>{screenshots.length}</span></button><button className={tab === 'results' ? 'selected' : ''} onClick={() => setTab('results')}><BarChart3 size={16}/>Test Results</button></nav>
    <input ref={picker} className="sr-only" aria-label="Upload screenshots" type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" multiple disabled={busy} onChange={e => { if (e.target.files) stage(e.target.files); e.target.value = ''; }}/>
    {error && <p className="error" role="alert">{error}</p>}
    {tab === 'results' ? <Results workspace={data}/> : <>
      <div className={`dropzone ${busy ? 'disabled' : ''}`} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (!busy) stage(e.dataTransfer.files); }}><div className="upload-icon"><ImagePlus size={27}/></div><div><h3>Drop your match screenshots here</h3><p>PNG or JPEG · Up to 8 MB each · Select up to 100 at a time</p></div><button disabled={busy} onClick={() => picker.current?.click()}>Choose files</button></div>
      {!!staged.length && <div className="panel"><div className="section-heading compact"><h3>Upload preview <span className="muted">({staged.length})</span></h3><button className="primary" disabled={busy || !validUploads} onClick={() => run(true)}><Play size={15}/>Analyze {validUploads + queued} Screenshots</button></div><div className="preview-grid">{staged.map(item => <div className="preview-card" key={item.id}>{item.preview && <img src={item.preview} alt={item.file.name}/>}<button className="remove-preview" aria-label={`Remove ${item.file.name}`} disabled={busy} onClick={() => remove(item)}><X size={14}/></button><strong title={item.file.name}>{item.file.name}</strong><small className={item.error ? 'danger-text' : 'muted'}>{item.error ?? `${(item.file.size / 1024 / 1024).toFixed(2)} MB · Ready`}</small></div>)}</div></div>}
      {(busy || progress.total > 0) && <div className="progress-panel" role="status" aria-live="polite"><div>{busy ? <LoaderCircle className="spin" size={18}/> : <CheckCircle2 size={18}/>}<strong>{progress.label}</strong><span>{progress.completed} / {progress.total} completed</span></div><progress value={progress.completed} max={progress.total || 1}/>{busy && <small>Keep this tab open while the batch runs. Each screenshot is saved independently.</small>}</div>}
      <div className="section-heading compact"><h3>Screenshot library</h3><div className="actions">{queued > 0 && <button disabled={busy} onClick={() => run(false)}><Play size={15}/>Analyze {queued} uploaded</button>}<select aria-label="Filter screenshots" value={filter} onChange={e => setFilter(e.target.value)}>{['ALL', 'UPLOADED', 'PROCESSING', 'COMPLETED', 'NEEDS_REVIEW', 'FAILED', 'VERIFIED'].map(s => <option key={s} value={s}>{s === 'ALL' ? 'All statuses' : s.replaceAll('_', ' ')}</option>)}</select></div></div>
      {!screenshots.length ? <div className="empty"><FileImage size={34}/><h3>Let the screenshots tell the story</h3><p>Upload your first match result. Compare the AI extraction with the original, then verify the numbers to start your benchmark.</p><div className="steps"><span>01 Upload</span><ChevronRight size={15}/><span>02 Analyze</span><ChevronRight size={15}/><span>03 Verify</span></div></div> : <div className="screenshot-grid">{screenshots.filter(s => filter === 'ALL' || s.status === filter).map((shot, index) => <button className="screenshot-card" key={shot.id} disabled={busy} onClick={() => setActive(shot.id)}><div className="thumb"><img loading="lazy" src={`/api/screenshots/${shot.id}/image`} alt={shot.filename}/><span className="image-index">{String(index + 1).padStart(2, '0')}</span></div><div className="card-body"><strong title={shot.filename}>{shot.filename}</strong><span className={`status ${shot.status.toLowerCase()}`}>{shot.status === 'PROCESSING' && <LoaderCircle size={12} className="spin"/>}{shot.status.replaceAll('_', ' ')}</span><div className="card-meta"><span>{shot.attempts.at(-1)?.aiResult?.screenType.replaceAll('_', ' ') ?? 'Awaiting extraction'}</span><span>{shot.attempts.length} run{shot.attempts.length === 1 ? '' : 's'}</span></div>{shot.attempts.at(-1)?.error && <small className="danger-text">{shot.attempts.at(-1)?.error}</small>}</div></button>)}</div>}
    </>}
  </>;
}
