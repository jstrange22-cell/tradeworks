import { useState, useCallback } from 'react';
import { Crosshair, Plus } from 'lucide-react';
import { ExecutionsList } from '@/components/solana/ExecutionsList';
import { SniperTemplateCard } from '@/components/solana/SniperTemplateCard';
import { SniperTemplateModal } from '@/components/solana/SniperTemplateModal';
import type { TemplateFormData } from '@/components/solana/SniperTemplateModal';
import type { TemplateStatusItem } from '@/types/solana';
import {
  useSniperTemplates, useCreateSniperTemplate, useUpdateSniperTemplate,
  useDeleteSniperTemplate, useToggleSniperTemplate, useSniperStatus,
} from '@/hooks/useSolana';

type ModalState =
  | { open: false }
  | { open: true; editing: TemplateStatusItem | null };

export function SniperTab() {
  const [modal, setModal] = useState<ModalState>({ open: false });

  const templatesQuery = useSniperTemplates(true);
  const sniperStatus = useSniperStatus(true);
  const createTemplate = useCreateSniperTemplate();
  const updateTemplate = useUpdateSniperTemplate();
  const deleteTemplate = useDeleteSniperTemplate();
  const toggleTemplate = useToggleSniperTemplate();

  const templates = templatesQuery.data?.data ?? [];
  const activeCount = templates.filter((tpl) => tpl.running).length;

  const handleToggle = useCallback((id: string, running: boolean) => {
    toggleTemplate.mutate({ id, running });
  }, [toggleTemplate]);

  const handleDelete = useCallback((id: string) => {
    deleteTemplate.mutate(id);
  }, [deleteTemplate]);

  const handleEdit = useCallback((template: TemplateStatusItem) => {
    setModal({ open: true, editing: template });
  }, []);

  const handleSave = useCallback((data: TemplateFormData, id?: string) => {
    if (id) {
      updateTemplate.mutate({ id, ...data }, {
        onSuccess: () => setModal({ open: false }),
      });
    } else {
      createTemplate.mutate(data, {
        onSuccess: () => setModal({ open: false }),
      });
    }
  }, [updateTemplate, createTemplate]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Crosshair className="h-5 w-5 text-red-400" />
          <h2 className="text-sm font-semibold text-slate-200">Sniping Engine</h2>
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
            activeCount > 0
              ? 'bg-green-500/20 text-green-400'
              : 'bg-slate-700 text-slate-500'
          }`}>
            {activeCount > 0 ? `${activeCount} ACTIVE` : 'ALL STOPPED'}
          </span>
        </div>
        <button
          onClick={() => setModal({ open: true, editing: null })}
          className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" /> Create Sniper
        </button>
      </div>

      {/* Template Grid */}
      {templates.length === 0 ? (
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 py-12 text-center">
          <Crosshair className="mx-auto mb-2 h-8 w-8 text-slate-600" />
          <p className="text-sm text-slate-500">No sniper templates yet</p>
          <p className="text-xs text-slate-600">Create one to start sniping tokens automatically</p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {templates.map((template) => (
            <SniperTemplateCard
              key={template.id}
              template={template}
              onToggle={handleToggle}
              onEdit={handleEdit}
              onDelete={handleDelete}
              isToggling={toggleTemplate.isPending}
              isDeleting={deleteTemplate.isPending}
            />
          ))}
        </div>
      )}

      {/* Recent Executions */}
      <ExecutionsList executions={sniperStatus.data?.recentExecutions} />

      {/* Create / Edit Modal */}
      {modal.open && (
        <SniperTemplateModal
          editing={modal.editing}
          onSave={handleSave}
          onClose={() => setModal({ open: false })}
          isSaving={createTemplate.isPending || updateTemplate.isPending}
        />
      )}
    </div>
  );
}
