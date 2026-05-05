/**
 * Heuristics store — read/write the human-editable
 * `openclaw-finance/learned_heuristics.md` file.
 *
 * The file is the single source of truth for prompt-evolution. It has three
 * sections, each containing zero or more `### lesson-<id>` blocks:
 *   - `## Pending Review`  (newly extracted, awaiting human approval)
 *   - `## Active`           (approved — these are injected into the reasoner)
 *   - `## Rejected`         (declined or deprecated)
 *
 * Each lesson block is a list of `- **Key:** value` lines. We deliberately
 * do NOT pull a markdown library — the format is fixed, line-oriented, and
 * trivial to parse with a small state machine.
 *
 * The file is meant to be human-editable. Manual edits survive every
 * write-back round-trip (we preserve unknown keys in a `extra` map).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { logger } from '../../../lib/logger.js';

export type LessonStatus = 'pending' | 'active' | 'rejected';
export type LessonImpact = 'low' | 'medium' | 'high';
export type LessonAppliesTo = 'buy' | 'sell' | 'all';

export interface Lesson {
  id: string;                    // e.g. "lesson-2026-05-04-001"
  status: LessonStatus;
  lesson: string;                // the actual one-sentence rule
  evidence?: string;             // citation back to decisions/outcomes
  appliesTo?: LessonAppliesTo;
  impact?: LessonImpact;
  createdAt?: string;            // ISO
  approvedAt?: string;           // ISO (for active)
  approvedBy?: string;
  rejectedAt?: string;           // ISO (for rejected)
  rejectedBy?: string;
  reason?: string;               // rejection reason
  lastTriggeredAt?: string;      // ISO; for stale-detection
  /** Unknown keys kept verbatim so manual edits survive a round-trip */
  extra: Record<string, string>;
}

export interface HeuristicsFile {
  /** Optional YAML-ish frontmatter we round-trip but don't otherwise use */
  frontmatter: string | null;
  /** Free-form prose between frontmatter and the first section */
  preamble: string;
  pending: Lesson[];
  active: Lesson[];
  rejected: Lesson[];
}

// ── Path resolution (mirrors reasoner.ts) ──────────────────────────────
const candidatePaths = [
  resolve(process.cwd(), 'openclaw-finance/learned_heuristics.md'),
  resolve(process.cwd(), '../../openclaw-finance/learned_heuristics.md'),
  '/opt/tradeworks/openclaw-finance/learned_heuristics.md',
];

export function resolveHeuristicsPath(): string {
  // Prefer existing file, else first candidate
  for (const p of candidatePaths) {
    if (existsSync(p)) return p;
  }
  return candidatePaths[0] as string;
}

const HEADER_PENDING = '## Pending Review';
const HEADER_ACTIVE = '## Active';
const HEADER_REJECTED = '## Rejected';

const SCAFFOLD = `---
# Auto-generated and human-editable. Lessons here are extracted nightly
# from losing trades by the post-mortem loop, then accepted/rejected via
# the admin UI. Items in "Active" are injected into the reasoner prompt.
version: 1
---

# Learned Heuristics

This file accumulates lessons APEX extracts from its own losing trades. New
items land in **Pending Review**. A human accepts or rejects them via the
\`/api/v1/post-mortem/approve\` endpoints. Only **Active** lessons are
prepended to the reasoner prompt.

${HEADER_PENDING}

${HEADER_ACTIVE}

${HEADER_REJECTED}
`;

// ── Scaffold: ensure file exists with the canonical structure ───────────
export function ensureScaffolded(filePath?: string): string {
  const path = filePath ?? resolveHeuristicsPath();
  if (existsSync(path)) return path;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, SCAFFOLD, 'utf8');
    logger.info({ path }, '[post-mortem] heuristics file scaffolded');
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, '[post-mortem] scaffold failed');
  }
  return path;
}

// ── Parser ─────────────────────────────────────────────────────────────
export function parseHeuristics(text: string): HeuristicsFile {
  const result: HeuristicsFile = {
    frontmatter: null,
    preamble: '',
    pending: [],
    active: [],
    rejected: [],
  };

  if (!text || text.trim().length === 0) return result;

  const lines = text.split(/\r?\n/);
  let cursor = 0;

  // 1. Optional frontmatter (--- ... ---)
  if (lines[cursor]?.trim() === '---') {
    const fmStart = cursor;
    cursor += 1;
    while (cursor < lines.length && lines[cursor]?.trim() !== '---') cursor += 1;
    if (cursor < lines.length) {
      result.frontmatter = lines.slice(fmStart, cursor + 1).join('\n');
      cursor += 1;
    } else {
      // Unterminated frontmatter — treat as preamble
      cursor = fmStart;
    }
  }

  // 2. Preamble until first section header
  const preambleLines: string[] = [];
  while (cursor < lines.length) {
    const l = lines[cursor];
    if (l !== undefined && (l === HEADER_PENDING || l === HEADER_ACTIVE || l === HEADER_REJECTED)) break;
    preambleLines.push(l ?? '');
    cursor += 1;
  }
  result.preamble = preambleLines.join('\n').replace(/\n+$/, '');

  // 3. Walk sections
  let currentSection: LessonStatus | null = null;
  let currentLesson: Lesson | null = null;

  const flushLesson = (): void => {
    if (!currentLesson || !currentSection) return;
    if (currentSection === 'pending') result.pending.push(currentLesson);
    else if (currentSection === 'active') result.active.push(currentLesson);
    else if (currentSection === 'rejected') result.rejected.push(currentLesson);
    currentLesson = null;
  };

  for (; cursor < lines.length; cursor += 1) {
    const line = lines[cursor];
    if (line === undefined) continue;

    if (line === HEADER_PENDING) { flushLesson(); currentSection = 'pending'; continue; }
    if (line === HEADER_ACTIVE) { flushLesson(); currentSection = 'active'; continue; }
    if (line === HEADER_REJECTED) { flushLesson(); currentSection = 'rejected'; continue; }

    // ### lesson-... starts a new lesson within current section
    const lessonMatch = line.match(/^###\s+(lesson-[A-Za-z0-9_-]+)\s*$/);
    if (lessonMatch && currentSection) {
      flushLesson();
      currentLesson = {
        id: lessonMatch[1] as string,
        status: currentSection,
        lesson: '',
        extra: {},
      };
      continue;
    }

    // - **Key:** value  (key/value within a lesson)
    if (currentLesson) {
      const kvMatch = line.match(/^-\s+\*\*([^:]+):\*\*\s*(.*)$/);
      if (kvMatch) {
        const key = (kvMatch[1] ?? '').trim().toLowerCase();
        const value = (kvMatch[2] ?? '').trim();
        applyKeyValue(currentLesson, key, value);
      }
    }
  }
  flushLesson();
  return result;
}

function applyKeyValue(l: Lesson, key: string, value: string): void {
  switch (key) {
    case 'status': {
      const v = value.toLowerCase();
      if (v === 'pending' || v === 'active' || v === 'rejected') l.status = v;
      return;
    }
    case 'lesson': l.lesson = value; return;
    case 'evidence': l.evidence = value; return;
    case 'applies to': {
      const v = value.toLowerCase();
      if (v === 'buy' || v === 'sell' || v === 'all') l.appliesTo = v;
      return;
    }
    case 'impact': {
      const v = value.toLowerCase();
      if (v === 'low' || v === 'medium' || v === 'high') l.impact = v;
      return;
    }
    case 'created': l.createdAt = value; return;
    case 'approved': {
      // "2026-04-29T08:14:00Z by jason"
      const parts = value.split(/\s+by\s+/i);
      l.approvedAt = (parts[0] ?? value).trim();
      if (parts.length > 1) l.approvedBy = (parts[1] ?? '').trim();
      return;
    }
    case 'rejected': {
      const parts = value.split(/\s+by\s+/i);
      l.rejectedAt = (parts[0] ?? value).trim();
      if (parts.length > 1) l.rejectedBy = (parts[1] ?? '').trim();
      return;
    }
    case 'reason': l.reason = value; return;
    case 'last triggered': l.lastTriggeredAt = value; return;
    default:
      l.extra[key] = value;
  }
}

// ── Serializer ─────────────────────────────────────────────────────────
export function serializeHeuristics(file: HeuristicsFile): string {
  const out: string[] = [];
  if (file.frontmatter) {
    out.push(file.frontmatter.trimEnd());
    out.push('');
  }
  if (file.preamble && file.preamble.trim().length > 0) {
    out.push(file.preamble.trimEnd());
    out.push('');
  }
  out.push(HEADER_PENDING);
  out.push('');
  for (const l of file.pending) out.push(...renderLesson(l));
  out.push(HEADER_ACTIVE);
  out.push('');
  for (const l of file.active) out.push(...renderLesson(l));
  out.push(HEADER_REJECTED);
  out.push('');
  for (const l of file.rejected) out.push(...renderLesson(l));
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

function renderLesson(l: Lesson): string[] {
  const lines: string[] = [];
  lines.push(`### ${l.id}`);
  lines.push(`- **Status:** ${l.status}`);
  if (l.lesson) lines.push(`- **Lesson:** ${l.lesson}`);
  if (l.evidence) lines.push(`- **Evidence:** ${l.evidence}`);
  if (l.appliesTo) lines.push(`- **Applies to:** ${l.appliesTo}`);
  if (l.impact) lines.push(`- **Impact:** ${l.impact}`);
  if (l.createdAt) lines.push(`- **Created:** ${l.createdAt}`);
  if (l.approvedAt) {
    const tail = l.approvedBy ? `${l.approvedAt} by ${l.approvedBy}` : l.approvedAt;
    lines.push(`- **Approved:** ${tail}`);
  }
  if (l.rejectedAt) {
    const tail = l.rejectedBy ? `${l.rejectedAt} by ${l.rejectedBy}` : l.rejectedAt;
    lines.push(`- **Rejected:** ${tail}`);
  }
  if (l.reason) lines.push(`- **Reason:** ${l.reason}`);
  if (l.lastTriggeredAt) lines.push(`- **Last triggered:** ${l.lastTriggeredAt}`);
  for (const [k, v] of Object.entries(l.extra)) {
    const titled = k.replace(/(^|\s)\S/g, (m) => m.toUpperCase());
    lines.push(`- **${titled}:** ${v}`);
  }
  lines.push('');
  return lines;
}

// ── High-level read/write ──────────────────────────────────────────────
export function readHeuristics(filePath?: string): HeuristicsFile {
  const path = ensureScaffolded(filePath);
  try {
    const text = readFileSync(path, 'utf8');
    return parseHeuristics(text);
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err, path }, '[post-mortem] readHeuristics failed');
    return parseHeuristics('');
  }
}

export function writeHeuristics(file: HeuristicsFile, filePath?: string): void {
  const path = filePath ?? resolveHeuristicsPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serializeHeuristics(file), 'utf8');
}

// ── Admin operations ───────────────────────────────────────────────────
export function appendPendingLesson(input: Omit<Lesson, 'status' | 'extra'> & { extra?: Record<string, string> }, filePath?: string): Lesson {
  const file = readHeuristics(filePath);
  const lesson: Lesson = {
    ...input,
    status: 'pending',
    extra: input.extra ?? {},
  };
  file.pending.push(lesson);
  writeHeuristics(file, filePath);
  return lesson;
}

export function approveLesson(
  id: string,
  approvedBy: string,
  filePath?: string,
): Lesson | null {
  const file = readHeuristics(filePath);
  const idx = file.pending.findIndex((l) => l.id === id);
  if (idx === -1) return null;
  const lesson = file.pending.splice(idx, 1)[0] as Lesson;
  lesson.status = 'active';
  lesson.approvedAt = new Date().toISOString();
  lesson.approvedBy = approvedBy;
  file.active.push(lesson);
  writeHeuristics(file, filePath);
  return lesson;
}

export function rejectLesson(
  id: string,
  rejectedBy: string,
  reason?: string,
  filePath?: string,
): Lesson | null {
  const file = readHeuristics(filePath);
  // Allow rejecting from pending OR active (deprecation path)
  let lesson: Lesson | null = null;
  const pIdx = file.pending.findIndex((l) => l.id === id);
  if (pIdx !== -1) {
    lesson = file.pending.splice(pIdx, 1)[0] as Lesson;
  } else {
    const aIdx = file.active.findIndex((l) => l.id === id);
    if (aIdx !== -1) lesson = file.active.splice(aIdx, 1)[0] as Lesson;
  }
  if (!lesson) return null;
  lesson.status = 'rejected';
  lesson.rejectedAt = new Date().toISOString();
  lesson.rejectedBy = rejectedBy;
  if (reason) lesson.reason = reason;
  file.rejected.push(lesson);
  writeHeuristics(file, filePath);
  return lesson;
}

// ── Reasoner integration: render Active lessons for prompt injection ───
const MAX_PROMPT_TOKENS = 500;

/**
 * Returns a markdown-formatted bullet list of currently active heuristics,
 * capped to the active token budget. Returns an empty string when there
 * are none, so callers can safely concatenate.
 */
export function renderActiveForPrompt(filePath?: string): string {
  const file = readHeuristics(filePath);
  if (file.active.length === 0) return '';
  // 4 chars/token rough approximation
  const maxChars = MAX_PROMPT_TOKENS * 4;
  const lines: string[] = ['## LEARNED HEURISTICS (from post-mortem analysis)'];
  let used = lines[0]!.length;
  for (const l of file.active) {
    if (!l.lesson) continue;
    const bullet = `- (${l.appliesTo ?? 'all'}) ${l.lesson}`;
    if (used + bullet.length > maxChars) break;
    lines.push(bullet);
    used += bullet.length + 1;
  }
  if (lines.length === 1) return '';
  return lines.join('\n');
}

// ── Stale-deprecation: auto-move active lessons that haven't fired in N days
export function deprecateStaleLessons(maxAgeDays = 60, filePath?: string): Lesson[] {
  const file = readHeuristics(filePath);
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const moved: Lesson[] = [];
  const keep: Lesson[] = [];
  for (const l of file.active) {
    const lastTrigger = l.lastTriggeredAt ? Date.parse(l.lastTriggeredAt) : NaN;
    const approvedAt = l.approvedAt ? Date.parse(l.approvedAt) : NaN;
    const reference = Number.isFinite(lastTrigger) ? lastTrigger : approvedAt;
    if (Number.isFinite(reference) && reference < cutoff) {
      l.status = 'rejected';
      l.rejectedAt = new Date().toISOString();
      l.rejectedBy = 'system-stale';
      l.reason = l.reason ?? `stale, no recent triggers in ${maxAgeDays}d`;
      file.rejected.push(l);
      moved.push(l);
    } else {
      keep.push(l);
    }
  }
  if (moved.length > 0) {
    file.active = keep;
    writeHeuristics(file, filePath);
  }
  return moved;
}

// Helper for tests: generate a stable lesson id.
export function makeLessonId(date = new Date(), seq = 1): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  const s = String(seq).padStart(3, '0');
  return `lesson-${y}-${m}-${d}-${s}`;
}
