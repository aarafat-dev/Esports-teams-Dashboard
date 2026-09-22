PRAGMA foreign_keys = ON;
CREATE TABLE tournaments (id TEXT PRIMARY KEY, name TEXT NOT NULL, date TEXT, createdAt TEXT NOT NULL);
CREATE TABLE screenshots (id TEXT PRIMARY KEY, tournamentId TEXT NOT NULL REFERENCES tournaments(id), filename TEXT NOT NULL, mime TEXT NOT NULL, uploadedAt TEXT NOT NULL, correctedResult TEXT, verifiedAt TEXT, verificationKind TEXT, verifiedAttemptId TEXT);
CREATE INDEX screenshots_tournament ON screenshots(tournamentId);
CREATE TABLE attempts (id TEXT PRIMARY KEY, screenshotId TEXT NOT NULL REFERENCES screenshots(id), model TEXT NOT NULL, timestamp TEXT NOT NULL, status TEXT NOT NULL, durationMs INTEGER, rawResponse TEXT, parsedResult TEXT, aiResult TEXT, warnings TEXT NOT NULL DEFAULT '[]', parsingErrors TEXT NOT NULL DEFAULT '[]', error TEXT, promptVersion TEXT NOT NULL, inputFormat TEXT NOT NULL);
CREATE INDEX attempts_screenshot ON attempts(screenshotId, timestamp);
CREATE UNIQUE INDEX one_active_attempt ON attempts(screenshotId) WHERE status = 'PROCESSING';
