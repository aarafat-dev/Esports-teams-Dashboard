import type { AnalysisResult } from './schemas';
import type { ValidationIssue } from './validation';
import type { AnalysisState } from '../shared/types';
export interface ProviderResult { rawResponse: string; parsedResult: unknown; aiResult: AnalysisResult | null; parsingErrors: string[]; warnings: ValidationIssue[]; analysisState: AnalysisState }
export interface DiagnosticResult { rawResponse: string; responseText: string | null; prompt: string; model: string; image: { mime: string; bytes: number; width: number | null; height: number | null; sha256: string }; durationMs: number }
export interface VisionProvider { analyzeFreeFireScreenshot(image: Uint8Array, mime: string): Promise<ProviderResult>; diagnoseFreeFireScreenshot(image: Uint8Array, mime: string): Promise<DiagnosticResult> }
