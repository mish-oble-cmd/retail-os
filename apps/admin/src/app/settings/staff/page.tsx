'use client';

import { Badge, Button, Input, Modal } from '@retailos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { AppShell } from '../../../components/app-shell';
import { SettingsTabs } from '../../../components/settings-tabs';
import { api, type MeResource } from '../../../lib/api';
import { staffApi, type RoleResource, type StaffResource } from '../../../lib/catalog-api';

type ModalState =
  | { kind: 'add' }
  | { kind: 'rename'; staff: StaffResource }
  | { kind: 'pin'; staff: StaffResource }
  | null;

/**
 * ADM-15a Staff & PINs (1F). Every business rule — owner gating, last-owner
 * protection, self-deactivation, PIN format/hashing — is enforced server-side
 * by StaffService; this page only renders state and surfaces the two guard
 * errors the same way the registers page surfaces its errors.
 */
export default function StaffPage() {
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.get<MeResource>('/api/v1/auth/me') });
  const staff = useQuery({ queryKey: ['staff'], queryFn: staffApi.listStaff });
  const roles = useQuery({ queryKey: ['roles'], queryFn: staffApi.listRoles });
  const [modal, setModal] = useState<ModalState>(null);
  const [actionError, setActionError] = useState('');

  const invalidateStaff = () => queryClient.invalidateQueries({ queryKey: ['staff'] });
  const onApiError = (error: unknown) =>
    setActionError(error instanceof Error ? error.message : String(error));

  const createStaff = useMutation({
    mutationFn: staffApi.createStaff,
    onSuccess: () => {
      setModal(null);
      setActionError('');
      void invalidateStaff();
    },
    onError: onApiError,
  });
  const updateStaff = useMutation({
    mutationFn: ({ id, ...input }: { id: string; name?: string; role_id?: string; active?: boolean }) =>
      staffApi.updateStaff(id, input),
    onSuccess: () => {
      setModal(null);
      setActionError('');
      void invalidateStaff();
    },
    onError: onApiError,
  });
  const setPin = useMutation({
    mutationFn: ({ id, pin }: { id: string; pin: string }) => staffApi.setPin(id, pin),
    onSuccess: () => {
      setModal(null);
      setActionError('');
      void invalidateStaff();
    },
    onError: onApiError,
  });

  const staffList = staff.data?.items ?? [];
  const roleList = roles.data?.items ?? [];

  return (
    <AppShell title="Settings">
      <SettingsTabs />
      <div className="flex max-w-4xl flex-col gap-4">
        {actionError ? (
          <p className="rounded border border-danger/40 bg-danger/5 px-3 py-2 text-body-sm text-danger">
            {actionError}
          </p>
        ) : null}

        <section className="overflow-hidden rounded-card border border-border bg-surface shadow-card">
          <div className="flex items-start gap-3 border-b border-border px-4 py-3">
            <div>
              <h3 className="text-body font-semibold text-ink">Staff & PINs</h3>
              <p className="text-caption text-ink-muted">
                Everyone who can sell at this store. A register PIN lets them unlock a paired POS
                device and stamps their name on every order they ring up.
              </p>
            </div>
            <Button size="sm" className="ml-auto flex-none" onClick={() => setModal({ kind: 'add' })}>
              Add staff
            </Button>
          </div>
          <table className="w-full border-collapse text-body-sm">
            <thead>
              <tr>
                <Th>Staff</Th>
                <Th>Email</Th>
                <Th>Role</Th>
                <Th>Register PIN</Th>
                <Th>Active</Th>
                <Th> </Th>
              </tr>
            </thead>
            <tbody>
              {staffList.map((row) => {
                const isSelf = row.id === me.data?.staff_id;
                // The store must keep one active Owner; the last one can't be
                // deactivated (server-enforced). Surface it as a visible hint,
                // not a hover-only tooltip.
                const isLastActiveOwner =
                  row.role_name === 'Owner' &&
                  row.active &&
                  staffList.filter((s) => s.role_name === 'Owner' && s.active).length === 1;
                return (
                  <tr key={row.id} className="border-t border-border">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-3">
                        <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-primary text-caption font-semibold text-white">
                          {initials(row.name)}
                        </span>
                        <span className={row.active ? 'font-medium text-ink' : 'font-medium text-ink-muted'}>
                          {row.name}
                          {isSelf ? <span className="ml-1.5 text-caption font-normal text-ink-muted">You</span> : null}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-ink-muted">{row.email ?? '— no email'}</td>
                    <td className="px-4 py-2.5">
                      <Badge tone={row.role_name === 'Owner' ? 'accent' : 'neutral'}>{row.role_name}</Badge>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge tone={row.has_pin ? 'success' : 'neutral'}>
                        {row.has_pin ? 'PIN set' : 'No PIN'}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={row.active}
                          title={
                            isSelf
                              ? "You can't deactivate your own account"
                              : row.active
                                ? 'Deactivate'
                                : 'Reactivate'
                          }
                          onClick={() => updateStaff.mutate({ id: row.id, active: !row.active })}
                          disabled={updateStaff.isPending}
                          className={`relative h-[22px] w-10 flex-none rounded-full transition-colors disabled:opacity-45 ${
                            row.active ? 'bg-success' : 'bg-border'
                          }`}
                        >
                          <span
                            className={`absolute top-0.5 h-[18px] w-[18px] rounded-full bg-white shadow-card transition-[left] ${
                              row.active ? 'left-[20px]' : 'left-0.5'
                            }`}
                          />
                        </button>
                        {isLastActiveOwner ? (
                          <span className="inline-flex items-center gap-1 text-caption text-ink-muted">
                            <svg
                              viewBox="0 0 24 24"
                              className="h-3.5 w-3.5"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth={1.75}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              aria-hidden="true"
                            >
                              <rect width="18" height="11" x="3" y="11" rx="2" />
                              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                            </svg>
                            Last owner
                          </span>
                        ) : !row.active ? (
                          <span className="text-caption text-ink-muted">Inactive</span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setModal({ kind: 'rename', staff: row })}>
                          Rename
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setModal({ kind: 'pin', staff: row })}>
                          {row.has_pin ? 'Reset PIN' : 'Set PIN'}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {staffList.length === 0 && !staff.isLoading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-ink-muted">
                    No staff yet — add the first cashier.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
          <div className="flex items-center gap-2 border-t border-border px-4 py-3 text-caption text-ink-muted">
            Two roles for now — an Owner can change settings and staff; a Cashier can sell and give
            up to a set discount. Custom roles, per-permission editing, and the staff audit log
            arrive in Phase 2.
          </div>
        </section>
      </div>

      {modal?.kind === 'add' ? (
        <AddStaffModal
          roles={roleList}
          onClose={() => setModal(null)}
          onSave={(input) => createStaff.mutate(input)}
          saving={createStaff.isPending}
        />
      ) : null}

      {modal?.kind === 'rename' ? (
        <RenameModal
          staff={modal.staff}
          onClose={() => setModal(null)}
          onSave={(name) => updateStaff.mutate({ id: modal.staff.id, name })}
          saving={updateStaff.isPending}
        />
      ) : null}

      {modal?.kind === 'pin' ? (
        <SetPinModal
          staff={modal.staff}
          onClose={() => setModal(null)}
          onSave={(pin) => setPin.mutate({ id: modal.staff.id, pin })}
          saving={setPin.isPending}
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

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

function AddStaffModal({
  roles,
  onClose,
  onSave,
  saving,
}: {
  roles: RoleResource[];
  onClose: () => void;
  onSave: (input: { name: string; email?: string; role_id: string }) => void;
  saving: boolean;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const defaultRole = roles.find((r) => r.name === 'Cashier') ?? roles[0];
  const [roleId, setRoleId] = useState(defaultRole?.id ?? '');

  // Roles typically arrive before the modal opens, but guard the race where
  // the list is still loading when "Add staff" is clicked.
  useEffect(() => {
    if (!roleId && defaultRole) setRoleId(defaultRole.id);
  }, [defaultRole, roleId]);

  return (
    <Modal
      open
      onClose={onClose}
      title="Add staff"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => onSave({ name: name.trim(), email: email.trim() || undefined, role_id: roleId })}
            disabled={!name.trim() || !roleId || saving}
          >
            {saving ? 'Saving…' : 'Add staff'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Input label="Name" value={name} onChange={(event) => setName(event.target.value)} autoFocus />
        <Input
          label="Email (optional)"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          hint="Only needed if they'll ever sign in to the admin."
        />
        <div>
          <p className="mb-1.5 text-body-sm font-medium text-ink">Role</p>
          <div className="flex gap-2">
            {roles.map((role) => (
              <button
                key={role.id}
                type="button"
                onClick={() => setRoleId(role.id)}
                className={`flex-1 rounded border px-3 py-2 text-left text-body-sm ${
                  roleId === role.id
                    ? 'border-primary bg-primary/10 font-semibold text-ink'
                    : 'border-border text-ink hover:bg-bg'
                }`}
              >
                {role.name}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function RenameModal({
  staff,
  onClose,
  onSave,
  saving,
}: {
  staff: StaffResource;
  onClose: () => void;
  onSave: (name: string) => void;
  saving: boolean;
}) {
  const [name, setName] = useState(staff.name);

  return (
    <Modal
      open
      onClose={onClose}
      title={`Rename — ${staff.name}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onSave(name.trim())} disabled={!name.trim() || saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <Input label="Name" value={name} onChange={(event) => setName(event.target.value)} autoFocus />
    </Modal>
  );
}

const PIN_PATTERN = /^\d{4,6}$/;

function SetPinModal({
  staff,
  onClose,
  onSave,
  saving,
}: {
  staff: StaffResource;
  onClose: () => void;
  onSave: (pin: string) => void;
  saving: boolean;
}) {
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const formatValid = PIN_PATTERN.test(pin);
  const matches = pin === confirm;
  const canSave = formatValid && matches && !saving;
  const showMismatch = confirm.length > 0 && !matches;

  return (
    <Modal
      open
      onClose={onClose}
      title={`${staff.has_pin ? 'Reset' : 'Set'} register PIN — ${staff.name}`}
      footer={
        <>
          <span className="mr-auto text-caption text-ink-muted">
            Stored hashed — reaches their device on next sync
          </span>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onSave(pin)} disabled={!canSave}>
            {saving ? 'Saving…' : 'Save PIN'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-body-sm text-ink-muted">
          They&apos;ll type this on a paired POS device to unlock it. 4 to 6 digits. You won&apos;t
          be able to view it later, only reset it.
        </p>
        <Input
          label="New PIN"
          value={pin}
          onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric"
          className="text-center font-money text-h3 tracking-[0.4em]"
          hint="Digits show while typing so you can double-check, then hide for good once saved."
          autoFocus
        />
        <Input
          label="Confirm PIN"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric"
          className="text-center font-money text-h3 tracking-[0.4em]"
          error={showMismatch ? "PINs don't match" : undefined}
        />
      </div>
    </Modal>
  );
}
