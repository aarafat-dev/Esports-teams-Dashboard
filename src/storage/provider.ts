import type { Attempt, Screenshot, Tournament } from '../shared/types';
import type { AnalysisResult } from '../ai/schemas';
export interface ImageStore { put(id: string, bytes: ArrayBuffer, mime: string): Promise<void>; get(id: string): Promise<{ bytes: ArrayBuffer; mime: string } | null>; delete(id: string): Promise<void> }
export interface BenchmarkStore {
  listTournaments(): Promise<Tournament[]>;
  createTournament(name: string, date: string | null): Promise<Tournament>;
  getTournament(id: string): Promise<Tournament | null>;
  listScreenshots(tournamentId: string): Promise<Screenshot[]>;
  getScreenshot(id: string): Promise<Screenshot | null>;
  createScreenshot(tournamentId: string, filename: string, mime: string, id: string): Promise<void>;
  createAttempt(attempt: Attempt): Promise<void>;
  finishAttempt(attempt: Attempt): Promise<void>;
  saveTruth(id: string, result: AnalysisResult, kind: 'CONFIRMED' | 'CORRECTED', attemptId: string | null): Promise<void>;
  expireAttempts(): Promise<void>;
}
