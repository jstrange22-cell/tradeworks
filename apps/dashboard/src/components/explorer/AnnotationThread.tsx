/**
 * Decision annotations — free-form notes the auditor adds to a decision.
 *
 * V2 fallback: persisted to localStorage keyed by decision id. When the
 * `decision_annotations` table lands, swap the storage layer here without
 * changing the UI surface.
 */
import { useEffect, useState } from 'react';
import { MessageCircle, Trash2 } from 'lucide-react';
import { DetailCard } from './DetailCard';

interface Annotation {
  id: string;
  text: string;
  createdAt: string;
  author: string;
}

interface AnnotationThreadProps {
  decisionId: string;
}

const STORAGE_PREFIX = 'tradeworks-explorer-annotations:';

function loadAnnotations(decisionId: string): Annotation[] {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${decisionId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Annotation[]) : [];
  } catch {
    return [];
  }
}

function saveAnnotations(decisionId: string, list: Annotation[]): void {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${decisionId}`, JSON.stringify(list));
  } catch {
    // Quota exceeded or storage disabled — silently no-op.
  }
}

export function AnnotationThread({ decisionId }: AnnotationThreadProps) {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    setAnnotations(loadAnnotations(decisionId));
  }, [decisionId]);

  const addAnnotation = () => {
    const text = draft.trim();
    if (text.length === 0) return;
    const next: Annotation[] = [
      ...annotations,
      {
        id: `note-${Date.now()}`,
        text,
        createdAt: new Date().toISOString(),
        author: 'me',
      },
    ];
    setAnnotations(next);
    saveAnnotations(decisionId, next);
    setDraft('');
  };

  const removeAnnotation = (id: string) => {
    const next = annotations.filter((a) => a.id !== id);
    setAnnotations(next);
    saveAnnotations(decisionId, next);
  };

  return (
    <DetailCard
      icon={<MessageCircle className="h-4 w-4 text-cyan-400" />}
      title="Notes"
      subtitle={
        annotations.length > 0
          ? `${annotations.length} annotation${annotations.length === 1 ? '' : 's'} (local)`
          : 'Your scratch pad for this decision (local-only for now)'
      }
    >
      <div className="space-y-3">
        <ul className="space-y-2">
          {annotations.length === 0 && (
            <li className="text-xs italic text-slate-500">No notes yet.</li>
          )}
          {annotations.map((a) => (
            <li
              key={a.id}
              className="rounded-md border border-slate-200/60 bg-slate-50/40 px-3 py-2 dark:border-slate-700/50 dark:bg-slate-800/30"
            >
              <div className="mb-0.5 flex items-center justify-between text-[10px] text-slate-500">
                <span>
                  {a.author} · {new Date(a.createdAt).toLocaleString()}
                </span>
                <button
                  type="button"
                  onClick={() => removeAnnotation(a.id)}
                  className="text-slate-500 hover:text-red-400"
                  aria-label="Delete annotation"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
              <div className="whitespace-pre-wrap text-xs text-slate-300">{a.text}</div>
            </li>
          ))}
        </ul>
        <div>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            placeholder="What did APEX get right or wrong here? What should change for next time?"
            className="input w-full resize-y text-xs"
          />
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={addAnnotation}
              disabled={draft.trim().length === 0}
              className="btn-primary px-3 py-1.5 text-xs"
            >
              Add note
            </button>
          </div>
        </div>
      </div>
    </DetailCard>
  );
}
