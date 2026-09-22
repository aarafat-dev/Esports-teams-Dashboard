import { useState } from 'react';
import { Download, Target } from 'lucide-react';
import { benchmark } from '../benchmark/accuracy';
import type { Workspace } from '../shared/types';
import { labels, percent } from './api';
export function Results({ workspace }: { workspace: Workspace }) {
  const [policy, setPolicy] = useState<'first' | 'latest'>('first');
  const results = benchmark(workspace.screenshots, policy);
  const exportData = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), policy, results, ...workspace }, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `benchmark-${workspace.tournament.id}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <section>
    <div className="section-heading"><div><p className="eyebrow">EXTRACTION BENCHMARK</p><h2>Test Results</h2><p className="muted">Every correction is evidence. Exact matches are the standard.</p></div><button onClick={exportData}><Download size={16}/>Export benchmark JSON</button></div>
    <div className="toolbar"><label>Evaluate <select value={policy} onChange={e => setPolicy(e.target.value as 'first' | 'latest')}><option value="first">First attempt per screenshot</option><option value="latest">Latest finished attempt per screenshot</option></select></label><span className="muted">Failed attempts remain in the evaluation.</span></div>
    <div className="metrics-grid">{[['Screenshots tested', results.tested], ['Human verified', results.verified], ['Confirmed without corrections', results.perfect], ['Requiring corrections', results.requiringCorrections], ['Failed screenshots', results.failed], ['Mean processing time', results.averageDurationMs === null ? '—' : `${(results.averageDurationMs / 1000).toFixed(1)}s`]].map(([label, value]) => <div className="metric" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
    <div className="perfect-banner"><Target size={30}/><div><span>Perfect screenshot rate</span><strong>{percent(results.perfectRate)}</strong></div><p>{results.perfect} / {results.evaluated} tested and verified screenshots match every required field, including row count and exact nicknames.</p></div>
    {results.models.length > 1 && <p className="notice">This selection includes multiple models. Export the attempt records to compare models separately.</p>}
    {!results.evaluated && <div className="empty"><Target size={32}/><h3>Your benchmark starts with ground truth</h3><p>Analyze a screenshot, review every visible field, then confirm it or save corrections. Failed analyses can also be corrected manually and evaluated.</p></div>}
    {Object.entries(results.groups).map(([type, fields]) => <div className="panel" key={type}><h3>{type.replaceAll('_', ' ')}</h3><div className="table-scroll"><table><thead><tr><th>Field</th><th>Exact accuracy</th><th>Correct / evaluated</th><th>Null truth excluded</th></tr></thead><tbody>{Object.entries(fields).sort((a, b) => (a[1].accuracy ?? 2) - (b[1].accuracy ?? 2)).map(([key, metric]) => <tr key={key}><td>{labels[key] ?? key}{key === 'name' && <small className="tag">STRICT</small>}</td><td><div className="accuracy-cell"><span>{percent(metric.accuracy)}</span><div className="bar"><i style={{ width: `${(metric.accuracy ?? 0) * 100}%` }}/></div></div></td><td>{metric.correct} / {metric.total}</td><td>{metric.excludedNull}</td></tr>)}</tbody></table></div></div>)}
    <p className="footnote">Players are compared by their visual row position. Missing and extra rows count as errors for every player field. Human null values are excluded from field accuracy; a hallucinated value in a null field still prevents a perfect screenshot. Optional raw placement/KDA audit strings and UNKNOWN reasons are not scored. First-attempt evaluation avoids cherry-picking retries. No fuzzy name matching is used.</p>
  </section>;
}
