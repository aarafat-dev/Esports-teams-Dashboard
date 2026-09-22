import { useEffect, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, ExternalLink, Plus, RotateCcw, Save, Trash2, ZoomIn, ZoomOut } from 'lucide-react';
import type { Screenshot } from '../shared/types';
import { detailedFields, emptyResult, summaryFields, type AnalysisResult, type ScreenType } from '../ai/schemas';
import { calculateTotals, validateAnalysis } from '../ai/validation';
import { normalizeMap } from '../ai/normalization';
import { api, jsonRequest, labels } from './api';

export function Review({ shot, onUpdate, onBack, onNext, onPrevious, position }: { shot: Screenshot; onUpdate: (shot: Screenshot) => void; onBack: () => void; onNext?: () => void; onPrevious?: () => void; position: string }) {
  const [attemptId, setAttemptId] = useState(shot.attempts.at(-1)?.id ?? '');
  const selected = shot.attempts.find(a => a.id === attemptId) ?? shot.attempts.at(-1);
  const [draft, setDraft] = useState<AnalysisResult>(() => structuredClone(shot.correctedResult ?? selected?.aiResult ?? emptyResult('UNKNOWN')));
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(''), [zoom, setZoom] = useState(100);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    window.addEventListener('beforeunload', handler); return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
  const navigate = (action?: () => void) => { if (action && (!dirty || window.confirm('Discard your unsaved corrections?'))) action(); };
  const change = (value: AnalysisResult) => { setDraft(value); setDirty(true); setSaved(''); };
  const updateTop = (field: string, value: unknown) => change({ ...draft, [field]: value } as AnalysisResult);
  const updatePlayer = (index: number, field: string, value: unknown) => {
    if (draft.screenType === 'UNKNOWN') return;
    change({ ...draft, players: draft.players.map((p, i) => i === index ? { ...p, [field]: value } : p) } as AnalysisResult);
  };
  const addPlayer = () => {
    if (draft.screenType === 'UNKNOWN') return;
    const fields = draft.screenType === 'MATCH_SUMMARY' ? summaryFields : detailedFields;
    change({ ...draft, players: [...draft.players, Object.fromEntries(fields.map(f => [f, null]))] } as AnalysisResult);
  };
  const movePlayer = (index: number, offset: number) => {
    if (draft.screenType === 'UNKNOWN') return;
    const players = [...draft.players];
    [players[index], players[index + offset]] = [players[index + offset], players[index]];
    change({ ...draft, players } as AnalysisResult);
  };
  const save = async (action: 'CONFIRMED' | 'CORRECTED', next = false) => {
    setBusy(true); setError(''); setSaved('');
    try {
      const updated = await api<Screenshot>(`/screenshots/${shot.id}/truth`, jsonRequest('PUT', { action, attemptId: selected?.id ?? null, ...(action === 'CORRECTED' ? { result: draft } : {}) }));
      onUpdate(updated); setDraft(structuredClone(updated.correctedResult!)); setDirty(false); setSaved('Ground truth saved. Original predictions are preserved.'); if (next) onNext?.();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const retry = async () => {
    if (dirty && !window.confirm('Retry analysis? Your unsaved edits remain in the editor.')) return;
    setBusy(true); setError('');
    try {
      const updated = await api<Screenshot>(`/screenshots/${shot.id}/analyze`, { method: 'POST' });
      onUpdate(updated); const latest = updated.attempts.at(-1); setAttemptId(latest?.id ?? '');
      if (!dirty && !updated.correctedResult && latest?.aiResult) setDraft(structuredClone(latest.aiResult));
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const issues = validateAnalysis(draft), totals = calculateTotals(draft);
  const tableFields = draft.screenType === 'MATCH_SUMMARY' ? summaryFields : detailedFields;
  return <section className="review">
    <div className="review-heading"><button className="ghost" disabled={busy} onClick={() => navigate(onBack)}><ArrowLeft size={16}/>Screenshots</button><span className="muted">{position}</span><div className="actions"><button aria-label="Previous screenshot" disabled={!onPrevious || busy} onClick={() => navigate(onPrevious)}><ArrowLeft size={16}/></button><button aria-label="Next screenshot" disabled={!onNext || busy} onClick={() => navigate(onNext)}><ArrowRight size={16}/></button></div></div>
    <div className="section-heading"><div><p className="eyebrow">SCREENSHOT REVIEW</p><h2>{shot.filename}</h2></div><span className={`status ${shot.status.toLowerCase()}`}>{shot.status.replaceAll('_', ' ')}</span></div>
    <div className="review-grid">
      <div className="image-panel"><div className="toolbar"><span>Original screenshot</span><div className="actions"><button aria-label="Zoom out" onClick={() => setZoom(Math.max(50, zoom - 25))}><ZoomOut size={16}/></button><span>{zoom}%</span><button aria-label="Zoom in" onClick={() => setZoom(Math.min(400, zoom + 25))}><ZoomIn size={16}/></button><a className="button" href={`/api/screenshots/${shot.id}/image`} target="_blank" rel="noreferrer" aria-label="Open full-size image"><ExternalLink size={16}/></a></div></div><div className="image-viewport"><img src={`/api/screenshots/${shot.id}/image`} alt={`Original Free Fire screenshot: ${shot.filename}`} style={{ width: `${zoom}%`, maxWidth: 'none' }}/></div><p className="footnote">Zoom and scroll to inspect nicknames and small values. Ground truth must follow the visible row order.</p></div>
      <div className="editor-panel">
        <div className="toolbar"><strong>Human review</strong><span className="tag">{dirty ? 'UNSAVED' : shot.correctedResult ? 'GROUND TRUTH' : 'AI PREDICTION'}</span></div>
        <label>Analysis attempt<select value={selected?.id ?? ''} disabled={busy} onChange={e => setAttemptId(e.target.value)}>{!shot.attempts.length && <option value="">No attempts yet</option>}{shot.attempts.map((a, i) => <option key={a.id} value={a.id}>#{i + 1} · {a.model.split('/').at(-1)} · {a.status} · {new Date(a.timestamp).toLocaleTimeString()}</option>)}</select></label>
        <div className="actions source-actions"><button disabled={!selected?.aiResult || busy} onClick={() => { if (!dirty || window.confirm('Replace unsaved edits with this prediction?')) { setDraft(structuredClone(selected!.aiResult!)); setDirty(false); setSaved('Selected prediction loaded into the editor.'); } }}>Load selected prediction</button>{shot.correctedResult && <button disabled={busy} onClick={() => { if (!dirty || window.confirm('Discard edits and load saved ground truth?')) { setDraft(structuredClone(shot.correctedResult!)); setDirty(false); } }}>Load ground truth</button>}</div>
        <p className="footnote">Selecting an attempt changes the debug view. Load its prediction to edit it. Saved ground truth is shared across attempts.</p>
        {selected?.error && <p className="error">{selected.error}</p>}{!!selected?.parsingErrors.length && <p className="notice">{selected.analysisState}: {selected.parsingErrors.join(' ')}</p>}
        <fieldset disabled={busy}>
          <div className="form-grid"><label>Screen Type<select value={draft.screenType} onChange={e => { const next = emptyResult(e.target.value as ScreenType); if (draft.screenType !== 'UNKNOWN' && next.screenType !== 'UNKNOWN') change({ ...next, mode: draft.mode, map: draft.map, mapRaw: draft.mapRaw, placement: draft.placement, totalTeams: draft.totalTeams }); else change(next); }}><option>MATCH_SUMMARY</option><option>DETAILED_STATS</option><option>UNKNOWN</option></select></label>
          {draft.screenType !== 'UNKNOWN' && <><label>Mode<select value={draft.mode ?? ''} onChange={e => updateTop('mode', e.target.value || null)}><option value="">Unreadable / missing</option><option value="BATTLE_ROYALE">Battle Royale</option></select></label><label>Map raw<input value={draft.mapRaw ?? ''} placeholder="null" onChange={e => change({ ...draft, mapRaw: e.target.value || null, map: normalizeMap(e.target.value || null) })}/></label><label>Map (canonical)<input value={draft.map ?? ''} placeholder="null" onChange={e => updateTop('map', e.target.value || null)}/></label><label>Placement<input type="number" step="1" value={draft.placement ?? ''} placeholder="null" onChange={e => updateTop('placement', e.target.value === '' ? null : Number(e.target.value))}/></label><label>Total Teams<input type="number" step="1" value={draft.totalTeams ?? ''} placeholder="null" onChange={e => updateTop('totalTeams', e.target.value === '' ? null : Number(e.target.value))}/></label></>}
          </div>
          {draft.screenType === 'UNKNOWN' ? <label>Review reason<textarea value={draft.reason ?? ''} onChange={e => updateTop('reason', e.target.value || null)} placeholder="Human review note"/></label> : <>
            <div className="section-heading compact"><h3>Player statistics</h3><button onClick={addPlayer} disabled={draft.players.length >= 16}><Plus size={15}/>Add Player</button></div>
            <div className="table-scroll"><table className="edit-table"><thead><tr><th>Row</th>{tableFields.map(f => <th key={f}>{labels[f]}</th>)}<th/></tr></thead><tbody>{draft.players.map((player, index) => <tr key={index}><td>{index + 1}</td>{tableFields.map(field => { const value = (player as Record<string, unknown>)[field]; const text = field === 'name' || field === 'survivalTime'; return <td key={field}><input aria-label={`Player ${index + 1} ${labels[field]}`} className={field === 'name' ? 'name-input' : ''} type={text ? 'text' : 'number'} step={field === 'headshotRate' ? 'any' : '1'} value={value === null || value === undefined ? '' : String(value)} placeholder="null" onChange={e => updatePlayer(index, field, e.target.value === '' ? null : text ? e.target.value : Number(e.target.value))}/></td>; })}<td><div className="actions"><button aria-label={`Move player ${index + 1} up`} disabled={index === 0} onClick={() => movePlayer(index, -1)}><ArrowUp size={13}/></button><button aria-label={`Move player ${index + 1} down`} disabled={index === draft.players.length - 1} onClick={() => movePlayer(index, 1)}><ArrowDown size={13}/></button><button className="icon-danger" aria-label={`Delete player ${index + 1}`} onClick={() => change({ ...draft, players: draft.players.filter((_, i) => i !== index) } as AnalysisResult)}><Trash2 size={15}/></button></div></td></tr>)}</tbody></table></div>
            {!draft.players.length && <p className="notice">No player rows. Add visible players to establish ground truth.</p>}
            <div className="totals">{Object.entries(totals).map(([key, value]) => <div key={key}><span>{key.replace('team', 'Team ')}</span><strong>{value ?? '—'}</strong></div>)}</div><p className="footnote">Blank fields mean null. A total is unavailable if any contributing value is missing.</p>
            <details><summary>Optional raw audit fields</summary><label>Raw placement<input value={draft.placementRaw ?? ''} onChange={e => updateTop('placementRaw', e.target.value || null)}/></label>{draft.screenType === 'DETAILED_STATS' && draft.players.map((p, i) => <label key={i}>Row {i + 1} raw K/D/A<input value={p.kdaRaw ?? ''} onChange={e => updatePlayer(i, 'kdaRaw', e.target.value || null)}/></label>)}</details>
          </>}
        </fieldset>
        {issues.length > 0 && <details className="validation"><summary>{issues.length} validation warning{issues.length === 1 ? '' : 's'} / errors</summary><ul>{issues.map((i, n) => <li key={n}>{i.severity} · {i.path}: {i.message}</li>)}</ul></details>}
        <p className="footnote">Field confidence: UNAVAILABLE. Cloudflare does not provide calibrated field confidence for this extraction.</p>
        {error && <p role="alert" className="error">{error}</p>}{saved && <p role="status" className="success">{saved}</p>}
        <div className="review-buttons"><button className="primary" disabled={busy || !selected?.aiResult || dirty || JSON.stringify(draft) !== JSON.stringify(selected.aiResult)} onClick={() => save('CONFIRMED')}><Check size={16}/>Confirm As Correct</button><button disabled={busy} onClick={() => save('CORRECTED')}><Save size={16}/>Save Corrections</button>{onNext && <button disabled={busy} onClick={() => save('CORRECTED', true)}>Save & next<ArrowRight size={16}/></button>}<button disabled={busy || shot.status === 'PROCESSING'} onClick={retry}><RotateCcw size={16}/>{busy ? 'Working…' : 'Retry AI Analysis'}</button></div>
        <p className="footnote">Confirm copies the selected AI attempt into ground truth. Save Corrections stores the editor values. Every retry creates a new attempt.</p>
        <details className="debug"><summary>AI Debug Information</summary><dl><dt>Model</dt><dd>{selected?.model ?? 'No attempt'}</dd><dt>Analysis state</dt><dd>{selected?.analysisState ?? '—'}</dd><dt>Duration</dt><dd>{selected?.durationMs === null || !selected ? '—' : `${(selected.durationMs / 1000).toFixed(2)}s`}</dd><dt>Prompt / input format</dt><dd>{selected?.promptVersion} / {selected?.inputFormat}</dd><dt>Confidence</dt><dd>UNAVAILABLE</dd></dl>{[['Raw AI response', selected?.rawResponse], ['Parsed result', selected?.parsedResult], ['Validated AI prediction', selected?.aiResult], ['Validation warnings', selected?.warnings], ['Parsing errors', selected?.parsingErrors], ['Saved ground truth', shot.correctedResult]].map(([title, value]) => <div key={title as string}><h4>{title as string}</h4><pre>{typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 2)}</pre></div>)}</details>
      </div>
    </div>
  </section>;
}
