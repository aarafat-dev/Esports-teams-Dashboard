import type { BenchmarkStore, ImageStore } from './provider';
import type { AnalysisResult } from '../ai/schemas';
import type { Attempt, Screenshot, Tournament } from '../shared/types';
type ShotRow = Omit<Screenshot, 'attempts' | 'status' | 'correctedResult'> & { correctedResult: string | null };
type AttemptRow = Omit<Attempt, 'parsedResult' | 'aiResult' | 'warnings' | 'parsingErrors'> & { parsedResult: string | null; aiResult: string | null; warnings: string; parsingErrors: string };
const decodeAttempt = (row: AttemptRow): Attempt => ({ ...row, parsedResult: JSON.parse(row.parsedResult ?? 'null'), aiResult: JSON.parse(row.aiResult ?? 'null'), warnings: JSON.parse(row.warnings), parsingErrors: JSON.parse(row.parsingErrors) });
export class D1BenchmarkStore implements BenchmarkStore {
  constructor(private db: D1Database) {}
  async listTournaments() { return (await this.db.prepare('SELECT t.*, (SELECT COUNT(*) FROM screenshots s WHERE s.tournamentId=t.id) AS screenshotCount FROM tournaments t ORDER BY createdAt DESC').all<Tournament>()).results; }
  async createTournament(name: string, date: string | null) {
    const value = { id: crypto.randomUUID(), name, date, createdAt: new Date().toISOString() };
    await this.db.prepare('INSERT INTO tournaments (id,name,date,createdAt) VALUES (?,?,?,?)').bind(value.id, name, date, value.createdAt).run();
    return value;
  }
  getTournament(id: string) { return this.db.prepare('SELECT * FROM tournaments WHERE id=?').bind(id).first<Tournament>(); }
  private hydrate(row: ShotRow, attempts: Attempt[]): Screenshot {
    const correctedResult: AnalysisResult | null = JSON.parse(row.correctedResult ?? 'null');
    const latest = attempts.at(-1);
    return { ...row, correctedResult, attempts, status: latest?.status === 'PROCESSING' ? 'PROCESSING' : correctedResult ? 'VERIFIED' : latest?.status ?? 'UPLOADED' };
  }
  async listScreenshots(tournamentId: string) {
    const rows = (await this.db.prepare('SELECT * FROM screenshots WHERE tournamentId=? ORDER BY uploadedAt,id').bind(tournamentId).all<ShotRow>()).results;
    const attempts = (await this.db.prepare('SELECT a.* FROM attempts a JOIN screenshots s ON s.id=a.screenshotId WHERE s.tournamentId=? ORDER BY a.timestamp,a.rowid').bind(tournamentId).all<AttemptRow>()).results.map(decodeAttempt);
    return rows.map(row => this.hydrate(row, attempts.filter(a => a.screenshotId === row.id)));
  }
  async getScreenshot(id: string) {
    const row = await this.db.prepare('SELECT * FROM screenshots WHERE id=?').bind(id).first<ShotRow>();
    if (!row) return null;
    const attempts = (await this.db.prepare('SELECT * FROM attempts WHERE screenshotId=? ORDER BY timestamp,rowid').bind(id).all<AttemptRow>()).results.map(decodeAttempt);
    return this.hydrate(row, attempts);
  }
  async createScreenshot(tournamentId: string, filename: string, mime: string, id: string) { await this.db.prepare('INSERT INTO screenshots (id,tournamentId,filename,mime,uploadedAt) VALUES (?,?,?,?,?)').bind(id, tournamentId, filename, mime, new Date().toISOString()).run(); }
  async createAttempt(a: Attempt) { await this.db.prepare('INSERT INTO attempts (id,screenshotId,model,timestamp,status,promptVersion,inputFormat) VALUES (?,?,?,?,?,?,?)').bind(a.id, a.screenshotId, a.model, a.timestamp, a.status, a.promptVersion, a.inputFormat).run(); }
  async finishAttempt(a: Attempt) { await this.db.prepare("UPDATE attempts SET status=?,analysisState=?,durationMs=?,rawResponse=?,parsedResult=?,aiResult=?,warnings=?,parsingErrors=?,error=? WHERE id=? AND status='PROCESSING'").bind(a.status, a.analysisState, a.durationMs, a.rawResponse, JSON.stringify(a.parsedResult), JSON.stringify(a.aiResult), JSON.stringify(a.warnings), JSON.stringify(a.parsingErrors), a.error, a.id).run(); }
  async saveTruth(id: string, result: AnalysisResult, kind: 'CONFIRMED' | 'CORRECTED', attemptId: string | null) { await this.db.prepare('UPDATE screenshots SET correctedResult=?,verifiedAt=?,verificationKind=?,verifiedAttemptId=? WHERE id=?').bind(JSON.stringify(result), new Date().toISOString(), kind, attemptId, id).run(); }
  async expireAttempts() { await this.db.prepare("UPDATE attempts SET status='FAILED', analysisState='AI_TIMEOUT', error='Processing was interrupted or exceeded five minutes. Retry to create a new attempt.' WHERE status='PROCESSING' AND timestamp < ?").bind(new Date(Date.now() - 300_000).toISOString()).run(); }
}
export class R2ImageStore implements ImageStore {
  constructor(private bucket: R2Bucket) {}
  async put(id: string, bytes: ArrayBuffer, mime: string) { await this.bucket.put(id, bytes, { httpMetadata: { contentType: mime } }); }
  async get(id: string) { const object = await this.bucket.get(id); return object ? { bytes: await object.arrayBuffer(), mime: object.httpMetadata?.contentType ?? 'application/octet-stream' } : null; }
  async delete(id: string) { await this.bucket.delete(id); }
}
