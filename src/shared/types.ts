import type { AnalysisResult } from '../ai/schemas';
import type { ValidationIssue } from '../ai/validation';
export type Status = 'UPLOADED' | 'PROCESSING' | 'COMPLETED' | 'NEEDS_REVIEW' | 'FAILED' | 'VERIFIED';
export type AnalysisState = 'UNKNOWN_SCREEN' | 'AI_REQUEST_FAILED' | 'IMAGE_INVALID' | 'AI_RESPONSE_PARSE_ERROR' | 'AI_SCHEMA_VALIDATION_ERROR' | 'AI_EMPTY_RESPONSE' | 'AI_TIMEOUT' | 'ANALYSIS_SUCCESS';
export interface Tournament { id: string; name: string; date: string | null; createdAt: string; screenshotCount?: number }
export interface Attempt { id: string; screenshotId: string; model: string; timestamp: string; status: Status; analysisState: AnalysisState | null; durationMs: number | null; rawResponse: string | null; parsedResult: unknown; aiResult: AnalysisResult | null; warnings: ValidationIssue[]; parsingErrors: string[]; error: string | null; promptVersion: string; inputFormat: string }
export interface Screenshot { id: string; tournamentId: string; filename: string; mime: string; uploadedAt: string; correctedResult: AnalysisResult | null; verifiedAt: string | null; verificationKind: 'CONFIRMED' | 'CORRECTED' | null; verifiedAttemptId: string | null; attempts: Attempt[]; status: Status }
export interface Workspace { tournament: Tournament; screenshots: Screenshot[] }
