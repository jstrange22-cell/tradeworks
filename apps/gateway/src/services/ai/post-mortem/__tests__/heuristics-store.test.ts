/**
 * Unit tests for heuristics-store.ts: parser/serializer round-trip, scaffold
 * tolerance for empty/missing files, approve/reject mutations, and the
 * reasoner-side rendering function.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  parseHeuristics,
  serializeHeuristics,
  ensureScaffolded,
  readHeuristics,
  writeHeuristics,
  appendPendingLesson,
  approveLesson,
  rejectLesson,
  renderActiveForPrompt,
  deprecateStaleLessons,
  makeLessonId,
} from '../heuristics-store.js';

let tmpDir: string;
let path: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'post-mortem-test-'));
  path = join(tmpDir, 'learned_heuristics.md');
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('parseHeuristics — empty / scaffold tolerance', () => {
  it('returns an empty file shape when given the empty string', () => {
    const file = parseHeuristics('');
    expect(file.pending).toEqual([]);
    expect(file.active).toEqual([]);
    expect(file.rejected).toEqual([]);
  });

  it('parses a scaffold with empty sections', () => {
    const scaffold = `---\nversion: 1\n---\n\n# Learned Heuristics\n\n## Pending Review\n\n## Active\n\n## Rejected\n`;
    const file = parseHeuristics(scaffold);
    expect(file.pending).toEqual([]);
    expect(file.active).toEqual([]);
    expect(file.rejected).toEqual([]);
    expect(file.frontmatter).toContain('version: 1');
  });
});

describe('parser/serializer round-trip', () => {
  it('round-trips a complete file with one lesson per section', () => {
    const md = [
      '---',
      'version: 1',
      '---',
      '',
      '# Learned Heuristics',
      '',
      '## Pending Review',
      '',
      '### lesson-2026-05-04-001',
      '- **Status:** pending',
      '- **Lesson:** Avoid BUY signals in risk-off when scout rank > 30',
      '- **Evidence:** 4/5 such trades closed at -1R',
      '- **Applies to:** buy',
      '- **Impact:** medium',
      '- **Created:** 2026-05-04T02:30:00Z',
      '',
      '## Active',
      '',
      '### lesson-2026-04-28-003',
      '- **Status:** active',
      '- **Lesson:** Veto SELL on a winning long > 5%',
      '- **Approved:** 2026-04-29T08:14:00Z by jason',
      '',
      '## Rejected',
      '',
      '### lesson-2026-04-21-007',
      '- **Status:** rejected',
      '- **Reason:** Already covered by SOUL.md rule',
      '',
    ].join('\n');
    const file = parseHeuristics(md);
    expect(file.pending).toHaveLength(1);
    expect(file.active).toHaveLength(1);
    expect(file.rejected).toHaveLength(1);
    const p = file.pending[0]!;
    expect(p.id).toBe('lesson-2026-05-04-001');
    expect(p.appliesTo).toBe('buy');
    expect(p.impact).toBe('medium');
    const a = file.active[0]!;
    expect(a.approvedBy).toBe('jason');
    expect(a.approvedAt).toBe('2026-04-29T08:14:00Z');

    // Round-trip
    const out = serializeHeuristics(file);
    const reparsed = parseHeuristics(out);
    expect(reparsed.pending).toHaveLength(1);
    expect(reparsed.active).toHaveLength(1);
    expect(reparsed.rejected).toHaveLength(1);
    expect(reparsed.pending[0]!.lesson).toBe(p.lesson);
  });

  it('preserves unknown keys on a manually-edited lesson', () => {
    const md = [
      '## Pending Review',
      '',
      '### lesson-x',
      '- **Status:** pending',
      '- **Lesson:** Test',
      '- **Custom Field:** preserve me',
      '',
      '## Active',
      '',
      '## Rejected',
      '',
    ].join('\n');
    const file = parseHeuristics(md);
    expect(file.pending[0]!.extra['custom field']).toBe('preserve me');
    const out = serializeHeuristics(file);
    expect(out).toContain('Custom Field');
    expect(out).toContain('preserve me');
  });
});

describe('ensureScaffolded', () => {
  it('creates the file with empty sections when missing', () => {
    expect(existsSync(path)).toBe(false);
    ensureScaffolded(path);
    expect(existsSync(path)).toBe(true);
    const content = readFileSync(path, 'utf8');
    expect(content).toContain('## Pending Review');
    expect(content).toContain('## Active');
    expect(content).toContain('## Rejected');
    // Reading the empty scaffold must not crash the parser
    const parsed = readHeuristics(path);
    expect(parsed.pending).toEqual([]);
  });

  it('is idempotent: a second call does not overwrite content', () => {
    ensureScaffolded(path);
    appendPendingLesson({ id: 'lesson-x', lesson: 'don\'t buy on Mondays' }, path);
    const before = readFileSync(path, 'utf8');
    ensureScaffolded(path);
    const after = readFileSync(path, 'utf8');
    expect(after).toBe(before);
  });
});

describe('approve / reject', () => {
  it('moves a pending lesson into active with approval metadata', () => {
    appendPendingLesson({ id: 'lesson-1', lesson: 'do thing' }, path);
    const approved = approveLesson('lesson-1', 'jason', path);
    expect(approved).not.toBeNull();
    expect(approved?.status).toBe('active');
    expect(approved?.approvedBy).toBe('jason');
    const file = readHeuristics(path);
    expect(file.pending).toHaveLength(0);
    expect(file.active).toHaveLength(1);
  });

  it('moves a pending lesson into rejected with reason', () => {
    appendPendingLesson({ id: 'lesson-2', lesson: 'meh' }, path);
    const rejected = rejectLesson('lesson-2', 'jason', 'too generic', path);
    expect(rejected?.reason).toBe('too generic');
    const file = readHeuristics(path);
    expect(file.pending).toHaveLength(0);
    expect(file.rejected).toHaveLength(1);
    expect(file.rejected[0]!.rejectedBy).toBe('jason');
  });

  it('returns null when id does not exist in pending or active', () => {
    expect(approveLesson('nope', 'jason', path)).toBeNull();
    expect(rejectLesson('nope', 'jason', undefined, path)).toBeNull();
  });

  it('can also reject an already-active lesson (deprecation path)', () => {
    appendPendingLesson({ id: 'lesson-3', lesson: 'rule' }, path);
    approveLesson('lesson-3', 'jason', path);
    const dep = rejectLesson('lesson-3', 'jason', 'no longer relevant', path);
    expect(dep?.status).toBe('rejected');
    const file = readHeuristics(path);
    expect(file.active).toHaveLength(0);
    expect(file.rejected).toHaveLength(1);
  });
});

describe('renderActiveForPrompt', () => {
  it('returns empty string when no active lessons', () => {
    ensureScaffolded(path);
    expect(renderActiveForPrompt(path)).toBe('');
  });

  it('renders active lessons as a bulleted block under the canonical header', () => {
    appendPendingLesson({ id: 'lesson-a', lesson: 'rule A', appliesTo: 'buy' }, path);
    approveLesson('lesson-a', 'jason', path);
    appendPendingLesson({ id: 'lesson-b', lesson: 'rule B', appliesTo: 'sell' }, path);
    approveLesson('lesson-b', 'jason', path);
    const out = renderActiveForPrompt(path);
    expect(out).toContain('## LEARNED HEURISTICS (from post-mortem analysis)');
    expect(out).toContain('(buy) rule A');
    expect(out).toContain('(sell) rule B');
  });
});

describe('deprecateStaleLessons', () => {
  it('moves active lessons older than maxAgeDays to rejected', () => {
    // Manually craft a file with an old approved lesson
    writeHeuristics({
      frontmatter: null,
      preamble: '',
      pending: [],
      active: [{
        id: 'lesson-old',
        status: 'active',
        lesson: 'old rule',
        approvedAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
        extra: {},
      }],
      rejected: [],
    }, path);
    const moved = deprecateStaleLessons(60, path);
    expect(moved).toHaveLength(1);
    const file = readHeuristics(path);
    expect(file.active).toHaveLength(0);
    expect(file.rejected).toHaveLength(1);
    expect(file.rejected[0]!.reason).toContain('stale');
  });

  it('keeps lessons that triggered recently', () => {
    writeHeuristics({
      frontmatter: null,
      preamble: '',
      pending: [],
      active: [{
        id: 'lesson-fresh',
        status: 'active',
        lesson: 'fresh rule',
        approvedAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
        lastTriggeredAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
        extra: {},
      }],
      rejected: [],
    }, path);
    const moved = deprecateStaleLessons(60, path);
    expect(moved).toHaveLength(0);
  });
});

describe('makeLessonId', () => {
  it('produces a stable yyyy-mm-dd-NNN id', () => {
    const id = makeLessonId(new Date(Date.UTC(2026, 4, 4)), 1);
    expect(id).toBe('lesson-2026-05-04-001');
    expect(makeLessonId(new Date(Date.UTC(2026, 4, 4)), 12)).toBe('lesson-2026-05-04-012');
  });
});

describe('manual-edit safety', () => {
  it('round-trips a hand-typed file the user might write', () => {
    const userFile = [
      '## Pending Review',
      '',
      '## Active',
      '',
      '### lesson-manual-1',
      '- **Status:** active',
      '- **Lesson:** I (Jason) added this rule by hand',
      '- **Applies to:** all',
      '',
      '## Rejected',
      '',
    ].join('\n');
    writeFileSync(path, userFile, 'utf8');
    const file = readHeuristics(path);
    expect(file.active).toHaveLength(1);
    expect(file.active[0]!.lesson).toContain('hand');
    // We must not crash, and serialize must produce something parseable
    const out = serializeHeuristics(file);
    expect(parseHeuristics(out).active).toHaveLength(1);
  });
});
