'use client';

import { Badge, Button, Input, Modal } from '@retailos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { AppShell } from '../../../components/app-shell';
import { SettingsTabs } from '../../../components/settings-tabs';
import {
  catalogApi,
  settingsApi,
  type GridLayout,
  type GridTile,
  type IssuedActivationCode,
  type RegisterResource,
} from '../../../lib/catalog-api';

/**
 * ADM-16 locations & registers. One location is the honest Phase 1 shape
 * (card, not a table of one); multi-location is a visible, disabled promise.
 * Activation codes are single-use, 24 h, shown exactly once. The grid editor
 * previews tiles at Sell-screen proportions; off-grid products stay sellable
 * via search/scan.
 */
export default function RegistersPage() {
  const queryClient = useQueryClient();
  const locations = useQuery({ queryKey: ['locations'], queryFn: settingsApi.listLocations });
  const registers = useQuery({ queryKey: ['registers'], queryFn: settingsApi.listRegisters });
  const [issued, setIssued] = useState<IssuedActivationCode | null>(null);
  const [newRegisterName, setNewRegisterName] = useState('');
  const [gridFor, setGridFor] = useState<RegisterResource | null>(null);
  const [actionError, setActionError] = useState('');

  const location = locations.data?.items[0];
  const invalidateRegisters = () => queryClient.invalidateQueries({ queryKey: ['registers'] });
  const onApiError = (error: unknown) =>
    setActionError(error instanceof Error ? error.message : String(error));

  const issueCode = useMutation({
    mutationFn: settingsApi.issueActivationCode,
    onSuccess: (code) => {
      setIssued(code);
      setActionError('');
      void invalidateRegisters();
    },
    onError: onApiError,
  });
  const revokeCode = useMutation({
    mutationFn: settingsApi.revokeActivationCode,
    onSuccess: () => {
      setActionError('');
      void invalidateRegisters();
    },
    onError: onApiError,
  });
  const createRegister = useMutation({
    mutationFn: settingsApi.createRegister,
    onSuccess: () => {
      setNewRegisterName('');
      setActionError('');
      void invalidateRegisters();
    },
    onError: onApiError,
  });
  const updateRegister = useMutation({
    mutationFn: ({ id, ...input }: { id: string; name?: string; active?: boolean; grid_layout?: GridLayout }) =>
      settingsApi.updateRegister(id, input),
    onSuccess: () => {
      setGridFor(null);
      setActionError('');
      void invalidateRegisters();
    },
    onError: onApiError,
  });

  return (
    <AppShell title="Locations & registers">
      <SettingsTabs />
      <div className="flex max-w-4xl flex-col gap-4">
        {actionError ? (
          <p className="rounded border border-danger/40 bg-danger/5 px-3 py-2 text-body-sm text-danger">
            {actionError}
          </p>
        ) : null}

        <section className="rounded-card border border-border bg-surface p-4 shadow-card">
          <div className="flex items-center gap-3">
            <div>
              <h3 className="text-body font-semibold text-ink">{location?.name ?? 'Location'}</h3>
              <p className="text-caption text-ink-muted">
                {location ? `Timezone ${location.timezone}` : 'No location yet — signup creates one'}
              </p>
            </div>
            <span className="ml-auto">
              <Button variant="secondary" size="sm" disabled title="Multi-location arrives in Phase 4">
                Add location
              </Button>
            </span>
          </div>
        </section>

        <section className="overflow-hidden rounded-card border border-border bg-surface shadow-card">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <h3 className="text-body font-semibold text-ink">Registers</h3>
            <form
              className="ml-auto flex items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (location && newRegisterName.trim()) {
                  createRegister.mutate({ location_id: location.id, name: newRegisterName.trim() });
                }
              }}
            >
              <Input
                placeholder="New register name"
                value={newRegisterName}
                onChange={(event) => setNewRegisterName(event.target.value)}
                aria-label="New register name"
              />
              <Button size="sm" type="submit" disabled={!location || createRegister.isPending}>
                Add register
              </Button>
            </form>
          </div>
          <table className="w-full border-collapse text-body-sm">
            <thead>
              <tr>
                <Th>Register</Th>
                <Th>Status</Th>
                <Th>Activation</Th>
                <Th>Grid</Th>
                <Th> </Th>
              </tr>
            </thead>
            <tbody>
              {(registers.data?.items ?? []).map((register) => (
                <tr key={register.id} className="border-t border-border">
                  <td className="px-4 py-2.5 font-medium text-ink">{register.name}</td>
                  <td className="px-4 py-2.5">
                    <Badge tone={register.active ? 'success' : 'neutral'}>
                      {register.active ? 'Active' : 'Inactive'}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5">
                    {register.pending_activation ? (
                      <span className="flex items-center gap-2">
                        <Badge tone="warning">
                          Code pending · expires{' '}
                          {new Date(register.pending_activation.expires_at).toLocaleString()}
                        </Badge>
                        <Button size="sm" variant="ghost" className="text-danger" onClick={() => revokeCode.mutate(register.id)}>
                          Revoke
                        </Button>
                      </span>
                    ) : (
                      <Button size="sm" variant="secondary" onClick={() => issueCode.mutate(register.id)} disabled={issueCode.isPending}>
                        Generate activation code
                      </Button>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-ink-muted">
                    {countTiles(register)} tiles
                    <Button size="sm" variant="ghost" onClick={() => setGridFor(register)}>
                      Edit grid
                    </Button>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => updateRegister.mutate({ id: register.id, active: !register.active })}
                    >
                      {register.active ? 'Deactivate' : 'Reactivate'}
                    </Button>
                  </td>
                </tr>
              ))}
              {(registers.data?.items ?? []).length === 0 && !registers.isLoading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-ink-muted">
                    No registers yet — add one, then activate the POS device with its one-time code.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </section>
      </div>

      <Modal
        open={issued !== null}
        onClose={() => setIssued(null)}
        title="Activation code — shown once"
        footer={<Button onClick={() => setIssued(null)}>Done</Button>}
      >
        {issued ? (
          <div className="flex flex-col items-center gap-3 py-2">
            <p className="rounded border-2 border-dashed border-border px-8 py-4 font-money text-h1 tracking-[0.3em] text-ink">
              {issued.code}
            </p>
            <p className="text-body-sm text-ink-muted">
              Type this on the POS device (POS-01). Single-use, expires{' '}
              {new Date(issued.expires_at).toLocaleString()}. Generating a new code revokes this one.
            </p>
          </div>
        ) : null}
      </Modal>

      {gridFor ? (
        <GridEditor
          register={gridFor}
          onClose={() => setGridFor(null)}
          onSave={(layout) => updateRegister.mutate({ id: gridFor.id, grid_layout: layout })}
          saving={updateRegister.isPending}
        />
      ) : null}
    </AppShell>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-2.5 text-left text-caption font-semibold uppercase tracking-wide text-ink-muted">
      {children}
    </th>
  );
}

function countTiles(register: RegisterResource): number {
  return register.grid_layout?.tiles?.length ?? 0;
}

/**
 * Grid designer: pick an empty cell, then a product from the palette.
 * Products already placed say "On grid" instead of offering a duplicate.
 */
function GridEditor({
  register,
  onClose,
  onSave,
  saving,
}: {
  register: RegisterResource;
  onClose: () => void;
  onSave: (layout: GridLayout) => void;
  saving: boolean;
}) {
  const columns = register.grid_layout?.columns ?? 4;
  const rows = 5;
  const [tiles, setTiles] = useState<GridTile[]>(register.grid_layout?.tiles ?? []);
  const [pickingCell, setPickingCell] = useState<{ row: number; col: number } | null>(null);
  const products = useQuery({
    queryKey: ['products', { forGrid: true }],
    queryFn: () => catalogApi.listProducts({ status: 'active', limit: 50 }),
  });

  const placed = new Set(tiles.map((tile) => tile.ref_id));
  const tileAt = (row: number, col: number) =>
    tiles.find((tile) => tile.row === row && tile.col === col);

  return (
    <Modal
      open
      onClose={onClose}
      title={`Grid layout — ${register.name}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onSave({ columns, tiles })} disabled={saving}>
            {saving ? 'Saving…' : 'Save layout'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-caption text-ink-muted">
          Tap an empty cell, then a product. Off-grid products stay sellable via search/scan.
        </p>
        <div
          className="grid gap-2"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: rows }).flatMap((_, row) =>
            Array.from({ length: columns }).map((_, col) => {
              const tile = tileAt(row, col);
              const isPicking = pickingCell?.row === row && pickingCell?.col === col;
              return (
                <button
                  key={`${row}-${col}`}
                  type="button"
                  className={`flex h-16 flex-col items-center justify-center rounded-md border p-1 text-center text-caption ${
                    tile
                      ? 'border-primary/40 bg-bg font-medium text-ink'
                      : isPicking
                        ? 'border-primary border-dashed text-primary'
                        : 'border-dashed border-border text-ink-muted hover:border-primary'
                  }`}
                  onClick={() =>
                    tile
                      ? setTiles((current) => current.filter((entry) => entry !== tile))
                      : setPickingCell({ row, col })
                  }
                  title={tile ? 'Remove from grid' : 'Place a product here'}
                >
                  {tile ? (tile.label ?? 'Product') : isPicking ? 'Pick below…' : '+'}
                </button>
              );
            }),
          )}
        </div>
        {pickingCell ? (
          <div className="max-h-40 overflow-auto rounded border border-border">
            {(products.data?.items ?? []).map((product) => {
              const onGrid = placed.has(product.id);
              return (
                <button
                  key={product.id}
                  type="button"
                  disabled={onGrid}
                  className="flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left text-body-sm last:border-b-0 hover:bg-bg disabled:opacity-50"
                  onClick={() => {
                    setTiles((current) => [
                      ...current,
                      {
                        row: pickingCell.row,
                        col: pickingCell.col,
                        kind: 'product',
                        ref_id: product.id,
                        label: product.name,
                      },
                    ]);
                    setPickingCell(null);
                  }}
                >
                  <span className="flex-1">{product.name}</span>
                  {onGrid ? <span className="text-caption text-ink-muted">On grid</span> : null}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
