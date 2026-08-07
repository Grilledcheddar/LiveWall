import { useEffect, useId, useMemo, useState } from 'react';
import { Copy, Pencil, Search, Trash2, X } from 'lucide-react';
import { Button } from './Button';
import { CollapsibleHeader } from './CollapsibleHeader';
import {
  activeLayoutSlots,
  applyLayoutTemplate,
  BUILT_IN_LAYOUTS,
  layoutOnlyState,
  normalizeLayoutTemplates,
  validateLayoutTemplate,
} from '../lib/layouts';
import {
  createWallPreset,
  deleteWallPreset,
  duplicateWallPreset,
  presetPreview,
  renameWallPreset,
  snapshotWall,
  updateWallPreset,
  workspaceDiff,
  normalizeWallPresets,
} from '../lib/walls';
import type {
  LayoutSlot,
  LayoutTemplate,
  LayoutTemplateFile,
  WallPresetFile,
  WallState,
} from '../lib/types';

interface Props {
  state: WallState;
  templates: LayoutTemplateFile;
  presets: WallPresetFile;
  saveState: (change: (state: WallState) => WallState) => Promise<unknown>;
  saveTemplates: (file: LayoutTemplateFile) => Promise<unknown>;
  savePresets: (file: WallPresetFile) => Promise<unknown>;
  onFeedback: (message: string) => void;
  collapsed?: { walls: boolean; layouts: boolean };
  onToggleCollapsed?: (section: 'walls' | 'layouts') => void;
}

function LayoutPreview({
  template,
}: {
  template: Pick<LayoutTemplate, 'columns' | 'rows' | 'slots'>;
}) {
  return (
    <div
      className="layout-preview"
      style={{
        gridTemplateColumns: `repeat(${template.columns}, 1fr)`,
        gridTemplateRows: `repeat(${template.rows}, 1fr)`,
      }}
      aria-hidden="true"
    >
      {template.slots.map((slot, index) => (
        <span
          key={slot.id}
          style={{
            gridColumn: `${slot.column} / span ${slot.columnSpan}`,
            gridRow: `${slot.row} / span ${slot.rowSpan}`,
          }}
        >
          {index + 1}
        </span>
      ))}
    </div>
  );
}

function Modal({
  title,
  returnFocus,
  dirty = false,
  onClose,
  children,
}: {
  title: string;
  returnFocus?: HTMLElement | null;
  dirty?: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const titleId = useId();
  const close = () => {
    if (dirty && !confirm('Discard your unsaved changes?')) return;
    onClose();
  };
  useEffect(() => {
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (dirty && !confirm('Discard your unsaved changes?')) return;
        onClose();
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      document.body.style.overflow = overflow;
      window.setTimeout(() => returnFocus?.focus(), 0);
    };
  }, [dirty, onClose, returnFocus]);
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && close()}
    >
      <section
        className="source-dialog p3-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="dialog-heading">
          <h2 id={titleId}>{title}</h2>
          <Button
            variant="ghost"
            className="icon-button"
            onClick={close}
            aria-label={`Close ${title}`}
          >
            <X />
          </Button>
        </header>
        {children}
      </section>
    </div>
  );
}

const blankSlots = (): LayoutSlot[] => [
  { id: crypto.randomUUID(), column: 1, row: 1, columnSpan: 6, rowSpan: 6 },
  { id: crypto.randomUUID(), column: 7, row: 1, columnSpan: 6, rowSpan: 6 },
  { id: crypto.randomUUID(), column: 1, row: 7, columnSpan: 12, rowSpan: 6 },
];

function LayoutBuilder({
  existing,
  templates,
  returnFocus,
  onSave,
  onClose,
}: {
  existing?: LayoutTemplate;
  templates: LayoutTemplateFile;
  returnFocus?: HTMLElement | null;
  onSave: (template: LayoutTemplate) => Promise<void>;
  onClose: () => void;
}) {
  const initialName = existing?.name ?? '';
  const initialSlots = existing?.slots ?? blankSlots();
  const [name, setName] = useState(initialName);
  const [columns, setColumns] = useState(existing?.columns ?? 12);
  const [rows, setRows] = useState(existing?.rows ?? 12);
  const [slots, setSlots] = useState<LayoutSlot[]>(initialSlots);
  const [history, setHistory] = useState<LayoutSlot[][]>([]);
  const [preview, setPreview] = useState(false);
  const [draftId] = useState(() => existing?.id ?? crypto.randomUUID());
  const [draftCreatedAt] = useState(() => existing?.createdAt ?? Date.now());
  const draft: LayoutTemplate = {
    id: draftId,
    name,
    builtIn: false,
    columns,
    rows,
    slots,
    appearance: existing?.appearance,
    createdAt: draftCreatedAt,
    updatedAt: existing?.updatedAt ?? draftCreatedAt,
  };
  const duplicateName = templates.templates.some(
    (item) => item.id !== draft.id && item.name.toLowerCase() === name.trim().toLowerCase(),
  );
  const valid = validateLayoutTemplate(draft) && !duplicateName;
  const dirty =
    name !== initialName ||
    columns !== (existing?.columns ?? 12) ||
    rows !== (existing?.rows ?? 12) ||
    JSON.stringify(slots) !== JSON.stringify(initialSlots);

  function changeSlots(next: LayoutSlot[]) {
    setHistory((items) => [...items.slice(-19), slots]);
    setSlots(next);
  }
  function patchSlot(id: string, change: Partial<LayoutSlot>) {
    changeSlots(slots.map((slot) => (slot.id === id ? { ...slot, ...change } : slot)));
  }
  return (
    <Modal
      title={existing ? 'Edit layout template' : 'New layout template'}
      dirty={dirty}
      returnFocus={returnFocus}
      onClose={onClose}
    >
      <div className="dialog-body layout-builder">
        <label>
          Unique template name
          <input value={name} onChange={(event) => setName(event.target.value)} autoFocus />
        </label>
        <div className="builder-grid-size">
          <label>
            Columns
            <input
              type="number"
              min="1"
              max="24"
              value={columns}
              onChange={(event) => setColumns(Number(event.target.value))}
            />
          </label>
          <label>
            Rows
            <input
              type="number"
              min="1"
              max="24"
              value={rows}
              onChange={(event) => setRows(Number(event.target.value))}
            />
          </label>
        </div>
        <LayoutPreview template={draft} />
        <p className="field-help">
          Use integer grid lines and spans. Invalid, overlapping, zero-size, or out-of-range slots
          cannot be saved.
        </p>
        <div className="slot-editor-list">
          {slots.map((slot, index) => (
            <fieldset key={slot.id}>
              <legend>Slot {index + 1}</legend>
              {(['column', 'row', 'columnSpan', 'rowSpan'] as const).map((field) => (
                <label key={field}>
                  {field === 'columnSpan' ? 'Width' : field === 'rowSpan' ? 'Height' : field}
                  <input
                    aria-label={`Slot ${index + 1} ${field}`}
                    type="number"
                    min="1"
                    max="24"
                    value={slot[field]}
                    onChange={(event) =>
                      patchSlot(slot.id, { [field]: Number(event.target.value) })
                    }
                  />
                </label>
              ))}
              <Button
                variant="destructive"
                type="button"
                disabled={slots.length === 1}
                onClick={() => changeSlots(slots.filter((item) => item.id !== slot.id))}
              >
                Remove
              </Button>
            </fieldset>
          ))}
        </div>
        <div className="builder-tools">
          <Button
            variant="secondary"
            type="button"
            disabled={slots.length >= 9}
            onClick={() =>
              changeSlots([
                ...slots,
                { id: crypto.randomUUID(), column: 1, row: 1, columnSpan: 1, rowSpan: 1 },
              ])
            }
          >
            Add slot
          </Button>
          <Button
            variant="secondary"
            type="button"
            disabled={!history.length}
            onClick={() => {
              const prior = history[history.length - 1];
              setHistory(history.slice(0, -1));
              setSlots(prior);
            }}
          >
            Undo
          </Button>
          <Button variant="ghost" type="button" onClick={() => changeSlots(blankSlots())}>
            Reset
          </Button>
          <Button variant="secondary" type="button" onClick={() => setPreview(!preview)}>
            {preview ? 'Hide Preview' : 'Preview'}
          </Button>
        </div>
        {preview && (
          <div className="builder-preview-callout">
            <LayoutPreview template={draft} />
            <span>{slots.length} usable slots</span>
          </div>
        )}
        {!valid && (
          <p className="validation-error">
            {duplicateName
              ? 'Template names must be unique.'
              : 'Fix the grid bounds or overlapping slots before saving.'}
          </p>
        )}
      </div>
      <footer className="dialog-actions">
        <Button
          variant="secondary"
          type="button"
          className="secondary"
          onClick={() => {
            if (!dirty || confirm('Discard your unsaved changes?')) onClose();
          }}
        >
          Cancel
        </Button>
        <Button variant="primary" disabled={!valid} onClick={() => void onSave(draft)}>
          Save Template
        </Button>
      </footer>
    </Modal>
  );
}

export function P3WorkspacePanel({
  state,
  templates = normalizeLayoutTemplates(undefined),
  presets = normalizeWallPresets(undefined),
  saveState,
  saveTemplates = () => Promise.resolve(),
  savePresets = () => Promise.resolve(),
  onFeedback,
  collapsed = { walls: false, layouts: false },
  onToggleCollapsed = () => undefined,
}: Props) {
  const [layoutPreview, setLayoutPreview] = useState<LayoutTemplate>();
  const [builder, setBuilder] = useState<LayoutTemplate | null>();
  const [builderOpen, setBuilderOpen] = useState(false);
  const [presetPreviewId, setPresetPreviewId] = useState<string>();
  const [loadedPresetId, setLoadedPresetId] = useState<string>();
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'updated' | 'name' | 'tiles'>('updated');
  const [returnFocus, setReturnFocus] = useState<HTMLElement | null>(null);
  const allLayouts = [...BUILT_IN_LAYOUTS, ...templates.templates];
  const selectedPreset = presets.presets.find((item) => item.id === presetPreviewId);
  const loadedPreset = presets.presets.find((item) => item.id === loadedPresetId);
  const modified = loadedPreset ? workspaceDiff(state, loadedPreset) : undefined;
  const shownPresets = useMemo(
    () =>
      presets.presets
        .filter((item) => item.name.toLowerCase().includes(search.toLowerCase()))
        .sort((a, b) =>
          sort === 'name'
            ? a.name.localeCompare(b.name)
            : sort === 'tiles'
              ? b.state.tiles.length - a.state.tiles.length
              : b.updatedAt - a.updatedAt,
        ),
    [presets, search, sort],
  );

  async function persistTemplate(template: LayoutTemplate) {
    const next = normalizeLayoutTemplates({
      ...templates,
      templates: [...templates.templates.filter((item) => item.id !== template.id), template],
    });
    await saveTemplates(next);
    setBuilderOpen(false);
    onFeedback(`Saved layout template '${template.name}'.`);
  }
  async function saveCurrent(name?: string) {
    const chosen = name ?? prompt('Wall preset name');
    if (chosen === null || !chosen.trim()) return;
    const next = createWallPreset(presets, chosen, state);
    await savePresets(next);
    setLoadedPresetId(next.presets.find((item) => item.name === chosen.trim())?.id);
    onFeedback(`Saved current wall as '${chosen.trim()}'.`);
  }
  function warnModified() {
    return (
      !modified?.modified ||
      confirm(
        'The live workspace differs from the loaded preset. Continue without updating the preset?',
      )
    );
  }

  return (
    <section className="p3-workspace" aria-label="Walls and Layouts">
      <section className="collapsible-section named-walls-section">
        <CollapsibleHeader
          title="Named Walls"
          summary={`${presets.presets.length} preset${presets.presets.length === 1 ? '' : 's'}`}
          expanded={!collapsed.walls}
          onToggle={() => onToggleCollapsed('walls')}
        />
        {!collapsed.walls && (
          <div className="workspace-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">LIVE WORKSPACE</span>
                <h2>Named Walls</h2>
                <p>Presets change only when you explicitly update them.</p>
              </div>
              <Button
                variant="primary"
                onClick={(event) => {
                  setReturnFocus(event.currentTarget);
                  void saveCurrent();
                }}
              >
                Save Current Wall
              </Button>
            </div>
            {loadedPreset && (
              <div className={`workspace-state ${modified?.modified ? 'modified' : ''}`}>
                <strong>Loaded: {loadedPreset.name}</strong>
                <span>
                  {modified?.modified
                    ? `Modified — ${modified.details.join('; ')}`
                    : 'Matches saved preset'}
                </span>
                <div>
                  <Button
                    variant="primary"
                    disabled={!modified?.modified}
                    onClick={() =>
                      void savePresets(updateWallPreset(presets, loadedPreset.id, state)).then(() =>
                        onFeedback(`Updated '${loadedPreset.name}'.`),
                      )
                    }
                  >
                    Update Preset
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => void saveCurrent(`${loadedPreset.name} copy`)}
                  >
                    Save As
                  </Button>
                </div>
              </div>
            )}
            <div className="preset-filters">
              <label>
                <Search size={15} />
                <input
                  aria-label="Search walls"
                  placeholder="Search walls"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              <label>
                Sort
                <select
                  value={sort}
                  onChange={(event) => setSort(event.target.value as typeof sort)}
                >
                  <option value="updated">Last updated</option>
                  <option value="name">Name</option>
                  <option value="tiles">Tile count</option>
                </select>
              </label>
            </div>
            {!shownPresets.length ? (
              <p className="empty-state">
                No named walls yet. Save the current workspace to create one.
              </p>
            ) : (
              <div className="preset-cards">
                {shownPresets.map((preset) => (
                  <article key={preset.id} className="preset-card">
                    <LayoutPreview
                      template={{
                        columns: 12,
                        rows: 12,
                        slots: activeLayoutSlots(preset.state),
                      }}
                    />
                    <div>
                      <strong>{preset.name}</strong>
                      <small>
                        {preset.state.tiles.length} tile{preset.state.tiles.length === 1 ? '' : 's'}{' '}
                        · {new Date(preset.updatedAt).toLocaleString()}
                      </small>
                    </div>
                    <div className="card-actions">
                      <Button
                        variant="secondary"
                        onClick={(event) => {
                          if (!warnModified()) return;
                          setReturnFocus(event.currentTarget);
                          setPresetPreviewId(preset.id);
                        }}
                      >
                        Preview
                      </Button>
                      <Button
                        variant="ghost"
                        aria-label={`Rename ${preset.name}`}
                        onClick={() => {
                          const name = prompt('Rename wall', preset.name);
                          if (name) void savePresets(renameWallPreset(presets, preset.id, name));
                        }}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        aria-label={`Duplicate ${preset.name}`}
                        onClick={() => {
                          const name = prompt('Duplicate wall as', `${preset.name} copy`);
                          if (name) void savePresets(duplicateWallPreset(presets, preset.id, name));
                        }}
                      >
                        <Copy />
                      </Button>
                      <Button
                        variant="destructive"
                        aria-label={`Delete ${preset.name}`}
                        onClick={() =>
                          confirm(`Delete '${preset.name}'?`) &&
                          void savePresets(deleteWallPreset(presets, preset.id))
                        }
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        )}
      </section>
      <section className="collapsible-section layouts-section">
        <CollapsibleHeader
          title="Wall Layouts"
          summary={`${state.layoutMode === 'automatic' ? 'Auto' : state.layoutMode === 'template' ? 'Custom' : 'Freeform'}, ${state.tiles.length} tile${state.tiles.length === 1 ? '' : 's'}`}
          expanded={!collapsed.layouts}
          onToggle={() => onToggleCollapsed('layouts')}
        />
        {!collapsed.layouts && (
          <div className="workspace-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">VISUAL ARRANGEMENTS</span>
                <h2>Layout Templates</h2>
                <p>
                  Templates move existing tile containers in display order without changing sources
                  or players.
                </p>
              </div>
              <Button
                variant="primary"
                onClick={(event) => {
                  setReturnFocus(event.currentTarget);
                  setBuilder(null);
                  setBuilderOpen(true);
                }}
              >
                New Custom Layout
              </Button>
            </div>
            <div className="layout-cards">
              {allLayouts.map((template) => {
                const overflow = state.tiles.length - template.slots.length;
                return (
                  <article key={template.id} className="layout-card">
                    <LayoutPreview template={template} />
                    <div>
                      <strong>{template.name}</strong>
                      <small>
                        {template.slots.length} slot{template.slots.length === 1 ? '' : 's'} ·{' '}
                        {template.builtIn ? 'Built in' : 'Custom'}
                      </small>
                      {overflow > 0 && (
                        <span className="validation-error">
                          {overflow} current tile{overflow === 1 ? '' : 's'} would not fit. Choose a
                          layout with at least {state.tiles.length} slots.
                        </span>
                      )}
                    </div>
                    <div className="card-actions">
                      <Button
                        variant="secondary"
                        onClick={(event) => {
                          setReturnFocus(event.currentTarget);
                          setLayoutPreview(template);
                        }}
                      >
                        Preview
                      </Button>
                      {!template.builtIn && (
                        <>
                          <Button
                            variant="ghost"
                            aria-label={`Edit ${template.name}`}
                            onClick={(event) => {
                              setReturnFocus(event.currentTarget);
                              setBuilder(template);
                              setBuilderOpen(true);
                            }}
                          >
                            <Pencil />
                          </Button>
                          <Button
                            variant="ghost"
                            aria-label={`Duplicate ${template.name}`}
                            onClick={() => {
                              const copy = {
                                ...template,
                                id: crypto.randomUUID(),
                                name: `${template.name} copy`,
                                createdAt: Date.now(),
                                updatedAt: Date.now(),
                              };
                              void persistTemplate(copy);
                            }}
                          >
                            <Copy />
                          </Button>
                          <Button
                            variant="destructive"
                            aria-label={`Delete ${template.name}`}
                            onClick={() =>
                              confirm(`Delete '${template.name}'?`) &&
                              void saveTemplates(
                                normalizeLayoutTemplates({
                                  ...templates,
                                  templates: templates.templates.filter(
                                    (item) => item.id !== template.id,
                                  ),
                                }),
                              )
                            }
                          >
                            <Trash2 />
                          </Button>
                        </>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        )}
      </section>
      {layoutPreview && (
        <Modal
          title={`Preview: ${layoutPreview.name}`}
          returnFocus={returnFocus}
          onClose={() => setLayoutPreview(undefined)}
        >
          <div className="dialog-body preview-dialog">
            <LayoutPreview template={layoutPreview} />
            <p>Tiles fill numbered slots in current display order. Empty slots remain available.</p>
            {state.tiles.length > layoutPreview.slots.length && (
              <p className="validation-error">
                Cannot apply: {state.tiles.length - layoutPreview.slots.length} tile(s) would not
                fit. No tile will be hidden or deleted.
              </p>
            )}
          </div>
          <footer className="dialog-actions">
            <Button variant="secondary" onClick={() => setLayoutPreview(undefined)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={state.tiles.length > layoutPreview.slots.length}
              onClick={() =>
                void saveState((current) => applyLayoutTemplate(current, layoutPreview)).then(
                  () => {
                    onFeedback(`Applied '${layoutPreview.name}' without reloading players.`);
                    setLayoutPreview(undefined);
                  },
                )
              }
            >
              Apply Layout
            </Button>
          </footer>
        </Modal>
      )}
      {builderOpen && (
        <LayoutBuilder
          existing={builder ?? undefined}
          templates={templates}
          returnFocus={returnFocus}
          onSave={persistTemplate}
          onClose={() => setBuilderOpen(false)}
        />
      )}
      {selectedPreset && (
        <Modal
          title={`Preview wall: ${selectedPreset.name}`}
          returnFocus={returnFocus}
          onClose={() => setPresetPreviewId(undefined)}
        >
          <div className="dialog-body wall-preview">
            <LayoutPreview
              template={{
                columns: 12,
                rows: 12,
                slots: activeLayoutSlots(selectedPreset.state),
              }}
            />
            <p>
              {presetPreview(selectedPreset, state).difference.details.join('; ') ||
                'This preset matches the current workspace.'}
            </p>
            <ol>
              {selectedPreset.state.tiles.map((tile) => (
                <li key={tile.id}>
                  <strong>{tile.name}</strong>
                  <small>{tile.source.url}</small>
                  {tile.queuedSource && <small>Queued: {tile.queuedSource.url}</small>}
                </li>
              ))}
            </ol>
            {selectedPreset.state.tiles.length > 9 && (
              <p className="validation-error">
                This preset exceeds the nine-tile limit and cannot be loaded.
              </p>
            )}
          </div>
          <footer className="dialog-actions">
            <Button variant="secondary" onClick={() => setPresetPreviewId(undefined)}>
              Cancel
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                void saveState((current) => layoutOnlyState(current, selectedPreset.state)).then(
                  () => {
                    onFeedback(`Applied only the layout from '${selectedPreset.name}'.`);
                    setPresetPreviewId(undefined);
                  },
                )
              }
            >
              Apply Layout Only
            </Button>
            <Button
              variant="destructive"
              disabled={selectedPreset.state.tiles.length > 9}
              onClick={() => {
                if (!confirm(`Replace the current wall with '${selectedPreset.name}'?`)) return;
                void saveState(() => snapshotWall(selectedPreset.state)).then(() => {
                  setLoadedPresetId(selectedPreset.id);
                  setPresetPreviewId(undefined);
                  onFeedback(`Loaded wall '${selectedPreset.name}'.`);
                });
              }}
            >
              Replace Current Wall
            </Button>
          </footer>
        </Modal>
      )}
    </section>
  );
}
