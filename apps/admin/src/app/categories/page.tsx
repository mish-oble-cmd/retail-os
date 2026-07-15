'use client';

import { Button, Input, Modal } from '@retailos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { AppShell } from '../../components/app-shell';
import { catalogApi, type CategoryResource } from '../../lib/catalog-api';

/**
 * ADM-05 categories: tree with inline rename, add child, reorder (order here
 * = tab order on every register), delete with stated consequences. Reference
 * data flows down — changes land on registers at the next catalog sync.
 */

interface TreeNode {
  category: CategoryResource;
  children: TreeNode[];
}

function buildTree(categories: CategoryResource[]): TreeNode[] {
  const byParent = new Map<string | null, CategoryResource[]>();
  for (const category of categories) {
    const key = category.parent_id;
    byParent.set(key, [...(byParent.get(key) ?? []), category]);
  }
  const attach = (parentId: string | null): TreeNode[] =>
    (byParent.get(parentId) ?? [])
      .sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id))
      .map((category) => ({ category, children: attach(category.id) }));
  return attach(null);
}

export default function CategoriesPage() {
  const queryClient = useQueryClient();
  const categoriesQuery = useQuery({ queryKey: ['categories'], queryFn: catalogApi.listCategories });
  const [newRootName, setNewRootName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [addingChildOf, setAddingChildOf] = useState<string | null>(null);
  const [childName, setChildName] = useState('');
  const [deleting, setDeleting] = useState<CategoryResource | null>(null);
  const [actionError, setActionError] = useState('');

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['categories'] });
  const onApiError = (error: unknown) => setActionError(error instanceof Error ? error.message : String(error));

  const create = useMutation({
    mutationFn: catalogApi.createCategory,
    onSuccess: () => {
      setNewRootName('');
      setChildName('');
      setAddingChildOf(null);
      setActionError('');
      void invalidate();
    },
    onError: onApiError,
  });
  const update = useMutation({
    mutationFn: ({ id, ...input }: { id: string; name?: string; sort?: number }) =>
      catalogApi.updateCategory(id, input),
    onSuccess: () => {
      setRenamingId(null);
      setActionError('');
      void invalidate();
    },
    onError: onApiError,
  });
  const remove = useMutation({
    mutationFn: catalogApi.deleteCategory,
    onSuccess: () => {
      setDeleting(null);
      setActionError('');
      void invalidate();
    },
    onError: (error) => {
      setDeleting(null);
      onApiError(error);
    },
  });

  const tree = buildTree(categoriesQuery.data?.items ?? []);

  function move(node: TreeNode, siblings: TreeNode[], direction: -1 | 1) {
    const index = siblings.indexOf(node);
    const swapWith = siblings[index + direction];
    if (!swapWith) return;
    // Swap sort values; ties broken by id, so make them explicit and distinct.
    update.mutate({ id: node.category.id, sort: index + direction });
    update.mutate({ id: swapWith.category.id, sort: index });
  }

  function renderNode(node: TreeNode, siblings: TreeNode[], depth: number) {
    const { category } = node;
    return (
      <li key={category.id}>
        <div
          className="group flex items-center gap-2 border-b border-border px-3 py-2 hover:bg-bg"
          style={{ paddingLeft: `${12 + depth * 24}px` }}
        >
          {renamingId === category.id ? (
            <form
              className="flex items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (renameValue.trim()) update.mutate({ id: category.id, name: renameValue.trim() });
              }}
            >
              <Input
                autoFocus
                value={renameValue}
                onChange={(event) => setRenameValue(event.target.value)}
                aria-label={`Rename ${category.name}`}
              />
              <Button size="sm" type="submit">
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setRenamingId(null)}>
                Cancel
              </Button>
            </form>
          ) : (
            <>
              <span className="font-medium text-ink">{category.name}</span>
              <span className="text-caption text-ink-muted">
                {node.children.length > 0 ? `${node.children.length} sub` : ''}
              </span>
              <span className="ml-auto hidden items-center gap-1 group-hover:flex">
                <Button size="sm" variant="ghost" onClick={() => move(node, siblings, -1)} aria-label={`Move ${category.name} up`}>
                  ↑
                </Button>
                <Button size="sm" variant="ghost" onClick={() => move(node, siblings, 1)} aria-label={`Move ${category.name} down`}>
                  ↓
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setRenamingId(category.id);
                    setRenameValue(category.name);
                  }}
                >
                  Rename
                </Button>
                {depth < 2 ? (
                  <Button size="sm" variant="ghost" onClick={() => setAddingChildOf(category.id)}>
                    Add child
                  </Button>
                ) : null}
                <Button size="sm" variant="ghost" className="text-danger" onClick={() => setDeleting(category)}>
                  Delete…
                </Button>
              </span>
            </>
          )}
        </div>
        {addingChildOf === category.id ? (
          <form
            className="flex items-center gap-2 border-b border-border px-3 py-2"
            style={{ paddingLeft: `${36 + depth * 24}px` }}
            onSubmit={(event) => {
              event.preventDefault();
              if (childName.trim())
                create.mutate({ name: childName.trim(), parent_id: category.id });
            }}
          >
            <Input
              autoFocus
              placeholder="Child category name"
              value={childName}
              onChange={(event) => setChildName(event.target.value)}
              aria-label={`New child of ${category.name}`}
            />
            <Button size="sm" type="submit" disabled={create.isPending}>
              Add
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAddingChildOf(null)}>
              Cancel
            </Button>
          </form>
        ) : null}
        {node.children.length > 0 ? (
          <ul>{node.children.map((child) => renderNode(child, node.children, depth + 1))}</ul>
        ) : null}
      </li>
    );
  }

  return (
    <AppShell
      title="Categories"
      topbar={
        <span className="text-body-sm text-ink-muted">
          order here = tab order on every register ·{' '}
          <Link href="/products" className="text-primary underline">
            back to products
          </Link>
        </span>
      }
    >
      <div className="flex max-w-3xl flex-col gap-3">
        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (newRootName.trim()) create.mutate({ name: newRootName.trim() });
          }}
        >
          <div className="w-72">
            <Input
              label="New top-level category"
              placeholder="e.g. Beverages"
              value={newRootName}
              onChange={(event) => setNewRootName(event.target.value)}
            />
          </div>
          <Button type="submit" disabled={create.isPending}>
            Add category
          </Button>
        </form>

        {actionError ? (
          <p className="rounded border border-danger/40 bg-danger/5 px-3 py-2 text-body-sm text-danger">
            {actionError}
          </p>
        ) : null}

        <div className="overflow-hidden rounded-card border border-border bg-surface shadow-card">
          {tree.length === 0 && !categoriesQuery.isLoading ? (
            <p className="px-4 py-10 text-center text-ink-muted">
              No categories yet — they become the tab strip on every register&apos;s Sell screen.
            </p>
          ) : (
            <ul>{tree.map((node) => renderNode(node, tree, 0))}</ul>
          )}
        </div>
      </div>

      <Modal
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={`Delete "${deleting?.name ?? ''}"?`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              onClick={() => deleting && remove.mutate(deleting.id)}
              disabled={remove.isPending}
            >
              Delete category
            </Button>
          </>
        }
      >
        <p className="text-body-sm text-ink">
          Selling is unaffected — products in this category keep selling and move to “No category”.
          Only register navigation changes, at the next catalog sync. Sub-categories must be
          removed first.
        </p>
      </Modal>
    </AppShell>
  );
}
