"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  Copy,
  KeyRound,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { TelegramLoginButton } from "@/components/telegram-login-button";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useTelegramAuth } from "@/components/TelegramAuthProvider";
import { requestJson } from "@/lib/app-api";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AGENT_TOKEN_SCOPES, SCOPE_HINT, SCOPE_LABEL, type AgentTokenScope } from "@/lib/agent-scopes";

type AgentToken = {
  _id: string;
  tokenPrefix: string;
  label: string;
  scopes: AgentTokenScope[];
  worldIds?: string[];
  canEditScopes?: boolean;
  expiresAt?: number;
  revokedAt?: number;
  lastUsedAt?: number;
  createdAt: number;
};

type TokenListResponse = {
  tokens: AgentToken[];
};

type TokenCreateResponse = {
  token: AgentToken;
  secret: string;
};
type TokenUpdateResponse = {
  token: AgentToken;
};

const SCOPES: Array<{ value: AgentTokenScope; label: string; hint: string }> = AGENT_TOKEN_SCOPES.map((value) => ({
  value, label: SCOPE_LABEL[value], hint: SCOPE_HINT[value],
}));

type WorldOption = { worldId: string; name: string };

/** The projects a takes-only token may work on (inspiration:adapt). */
function ProjectPicker({ worlds, value, onChange, disabled }: {
  worlds: WorldOption[] | undefined; value: string[]; onChange: (next: string[]) => void; disabled?: boolean;
}) {
  if (!worlds) return <p className="mt-2 text-xs text-neutral-500">Loading projects…</p>;
  return (
    <div className="mt-2 border-l-2 border-[var(--line)] pl-3">
      <div className="mb-1 text-xs font-medium text-neutral-700">Projects it may make takes for</div>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {worlds.map((world) => (
          <label key={world.worldId} className="flex items-center gap-2 text-xs text-neutral-700">
            <Checkbox
              checked={value.includes(world.worldId)}
              disabled={disabled}
              onCheckedChange={(checked) => onChange(checked === true
                ? Array.from(new Set([...value, world.worldId]))
                : value.filter((id) => id !== world.worldId))}
            />
            {world.name}
          </label>
        ))}
      </div>
      {value.length === 0 ? <p className="mt-1 text-xs text-red-700">Pick at least one project.</p> : null}
    </div>
  );
}

const formatDate = (value?: number) => {
  if (!value) return "Never";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
};

export function AgentTokenManager() {
  const { user, isLoading } = useTelegramAuth();
  const [tokens, setTokens] = useState<AgentToken[]>([]);
  const [label, setLabel] = useState("Codex");
  const [expiresInDays, setExpiresInDays] = useState("90");
  const [scopes, setScopes] = useState<AgentTokenScope[]>([
    "gallery:read",
    "gallery:write",
  ]);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingTokenId, setEditingTokenId] = useState<string | null>(null);
  const [editedScopes, setEditedScopes] = useState<AgentTokenScope[]>([]);
  const [worldIds, setWorldIds] = useState<string[]>([]);
  const [editedWorldIds, setEditedWorldIds] = useState<string[]>([]);
  const { isAuthenticated } = useConvexAuth();
  const worldRows = useQuery(api.worlds.listWorlds, isAuthenticated && user ? { ownerUserId: user.ownerUserId } : "skip");
  const worlds = useMemo(() => worldRows?.map((row) => ({ worldId: row.worldId as string, name: row.name })), [worldRows]);
  const worldName = useCallback((id: string) => worlds?.find((world) => world.worldId === id)?.name ?? "a project", [worlds]);

  const canCreate = useMemo(
    () => Boolean(label.trim()) && scopes.length > 0 && !busy && (!scopes.includes("inspiration:adapt") || worldIds.length > 0),
    [busy, label, scopes, worldIds.length],
  );

  const loadTokens = useCallback(async () => {
    if (!user) return;
    setError(null);
    const data = await requestJson<TokenListResponse>("/api/agent/tokens");
    setTokens(data.tokens);
  }, [user]);

  useEffect(() => {
    void loadTokens().catch((err) => {
      setError(err instanceof Error ? err.message : "Failed to load agent tokens.");
    });
  }, [loadTokens]);

  const toggleScope = (scope: AgentTokenScope) => {
    setScopes((current) =>
      current.includes(scope)
        ? current.filter((value) => value !== scope)
        : [...current, scope],
    );
  };

  const createToken = async () => {
    if (!canCreate) return;
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const data = await requestJson<TokenCreateResponse>("/api/agent/tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          label,
          scopes,
          ...(scopes.includes("inspiration:adapt") ? { worldIds } : {}),
          expiresInDays: Number(expiresInDays) || undefined,
        }),
      });
      setCreatedSecret(data.secret);
      setTokens((current) => [data.token, ...current]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create agent token.");
    } finally {
      setBusy(false);
    }
  };

  const revokeToken = async (tokenId: string) => {
    setBusy(true);
    setError(null);
    try {
      await requestJson(`/api/agent/tokens/${tokenId}`, { method: "DELETE" });
      setTokens((current) => current.filter((token) => token._id !== tokenId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke agent token.");
    } finally {
      setBusy(false);
    }
  };

  const editPermissions = (token: AgentToken) => {
    if (!token.canEditScopes || busy) return;
    setEditingTokenId(token._id);
    setEditedScopes([...token.scopes]);
    setEditedWorldIds([...(token.worldIds ?? [])]);
    setError(null);
  };

  const savePermissions = async () => {
    if (!editingTokenId || editedScopes.length === 0 || busy) return;
    if (editedScopes.includes("inspiration:adapt") && editedWorldIds.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const data = await requestJson<TokenUpdateResponse>(
        `/api/agent/tokens/${editingTokenId}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            scopes: editedScopes,
            ...(editedScopes.includes("inspiration:adapt") ? { worldIds: editedWorldIds } : {}),
          }),
        },
      );
      setTokens((current) =>
        current.map((token) => token._id === data.token._id ? data.token : token),
      );
      setEditingTokenId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update permissions.");
    } finally {
      setBusy(false);
    }
  };

  const copySecret = async () => {
    if (!createdSecret) return;
    await navigator.clipboard.writeText(createdSecret);
    setCopied(true);
  };

  if (isLoading) {
    return <main className="min-h-screen bg-[var(--paper)]" />;
  }

  if (!user) {
    return (
      <main className="grid min-h-screen place-items-center bg-[var(--paper)] px-4">
        <div className="w-full max-w-sm">
          <TelegramLoginButton size="large" />
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[var(--paper)] px-4 py-6 text-[var(--text)] md:px-8">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
        <header className="flex flex-col gap-3 border-b border-[var(--line)] pb-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-[var(--text-muted)]">
              <KeyRound className="h-4 w-4" />
              Agent access
            </div>
            <h1 className="text-2xl font-semibold tracking-normal">Tokens</h1>
          </div>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void loadTokens()}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </header>

        {error ? (
          <div className="border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
            {error}
          </div>
        ) : null}

        {createdSecret ? (
          <section className="border border-[var(--ink)] bg-white p-4 text-neutral-900 shadow-[var(--shadow-brutal)]">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <Check className="h-4 w-4" />
              New token
            </div>
            <div className="flex flex-col gap-2 md:flex-row">
              <code className="min-w-0 flex-1 overflow-x-auto border border-[var(--line)] bg-white px-3 py-2 text-xs text-neutral-900">
                {createdSecret}
              </code>
              <Button variant="outline" onClick={() => void copySecret()}>
                <Copy className="h-4 w-4" />
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          </section>
        ) : null}

        <section className="grid gap-4 md:grid-cols-[minmax(280px,360px)_1fr]">
          <div className="border border-[var(--line)] bg-white p-4 text-neutral-900">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Create</h2>
              <Button disabled={!canCreate} onClick={() => void createToken()}>
                <Plus className="h-4 w-4" />
                Create
              </Button>
            </div>

            <div className="space-y-4">
              <label className="block text-xs font-medium text-neutral-700">
                Label
                <Input
                  className="mt-1 rounded-none"
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                />
              </label>

              <label className="block text-xs font-medium text-neutral-700">
                Expires in days
                <Input
                  className="mt-1 rounded-none"
                  inputMode="numeric"
                  value={expiresInDays}
                  onChange={(event) => setExpiresInDays(event.target.value)}
                />
              </label>

              <div>
                <div className="mb-2 text-xs font-medium text-neutral-700">Scopes</div>
                <div className="space-y-2">
                  {SCOPES.map((scope) => (
                    <label
                      key={scope.value}
                      className="flex items-center gap-2 text-xs text-neutral-700"
                    >
                      <Checkbox
                        checked={scopes.includes(scope.value)}
                        onCheckedChange={() => toggleScope(scope.value)}
                      />
                      <span>
                        {scope.label}
                        <span className="block text-[11px] text-neutral-500">{scope.hint}</span>
                      </span>
                    </label>
                  ))}
                </div>
                {scopes.includes("inspiration:adapt") ? (
                  <ProjectPicker worlds={worlds} value={worldIds} onChange={setWorldIds} disabled={busy} />
                ) : null}
                <p className="mt-3 text-xs text-neutral-500">
                  For a helper that only saves inspiration, tick Capture alone. For a project helper, tick
                  Takes alone and pick its projects. Neither can read or change the rest of the gallery.
                </p>
                <p className="mt-3 text-xs text-neutral-500">
                  Delete permits removing content. Agents still need your explicit
                  approval for the named items before deleting them.
                </p>
              </div>
            </div>
          </div>

          <div className="overflow-hidden border border-[var(--line)] bg-white text-neutral-900">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 border-b border-[var(--line)] px-3 py-2 text-xs font-semibold text-neutral-500 sm:grid-cols-[minmax(0,1fr)_80px_80px_140px]">
              <span>Token</span>
              <span className="hidden sm:block">Last used</span>
              <span className="hidden sm:block">Expires</span>
              <span>Actions</span>
            </div>
            {tokens.length === 0 ? (
              <div className="px-3 py-8 text-sm text-neutral-500">
                No active tokens.
              </div>
            ) : (
              tokens.map((token) => (
                <div
                  key={token._id}
                  className="border-b border-[var(--line)] px-3 py-3 text-xs last:border-b-0"
                >
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_80px_80px_140px]">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{token.label}</div>
                      <div className="mt-1 flex flex-wrap gap-1 text-[11px] text-neutral-500">
                        <span>{token.tokenPrefix}</span>
                        <span>{token.scopes.map((scope) => SCOPE_LABEL[scope] ?? scope).join(", ")}</span>
                        {token.worldIds?.length ? <span>· {token.worldIds.map(worldName).join(", ")}</span> : null}
                      </div>
                      <div className="mt-1 text-neutral-500 sm:hidden">
                        Last used {formatDate(token.lastUsedAt)} · Expires {formatDate(token.expiresAt)}
                      </div>
                      {!token.canEditScopes ? (
                        <div className="mt-1 text-neutral-500">
                          Reconnect OAuth or replace an expired token to change permissions.
                        </div>
                      ) : null}
                    </div>
                    <span className="hidden sm:block">{formatDate(token.lastUsedAt)}</span>
                    <span className="hidden sm:block">{formatDate(token.expiresAt)}</span>
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy || !token.canEditScopes}
                        aria-label={`Edit permissions for ${token.label}`}
                        onClick={() => editPermissions(token)}
                      >
                        Permissions
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={busy}
                        aria-label={`Revoke ${token.label}`}
                        onClick={() => void revokeToken(token._id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  {editingTokenId === token._id && token.canEditScopes ? (
                    <div className="mt-3 border-t border-[var(--line)] pt-3">
                      <div className="flex flex-wrap gap-4">
                        {SCOPES.map((scope) => (
                          <label key={scope.value} className="flex items-center gap-2">
                            <Checkbox
                              checked={editedScopes.includes(scope.value)}
                              disabled={busy}
                              onCheckedChange={(checked) => setEditedScopes((current) =>
                                checked === true
                                  ? Array.from(new Set([...current, scope.value]))
                                  : current.filter((value) => value !== scope.value),
                              )}
                            />
                            {scope.label}
                          </label>
                        ))}
                      </div>
                      {editedScopes.includes("inspiration:adapt") ? (
                        <ProjectPicker worlds={worlds} value={editedWorldIds} onChange={setEditedWorldIds} disabled={busy} />
                      ) : null}
                      <p className="mt-3 text-neutral-500">
                        Changes apply to this connection immediately; its token stays the same.
                        Enabling Delete grants access, not approval to delete any item.
                        Agents must obtain your approval for each named item or batch.
                      </p>
                      <div className="mt-3 flex gap-2">
                        <Button disabled={busy || editedScopes.length === 0 || (editedScopes.includes("inspiration:adapt") && editedWorldIds.length === 0)} onClick={() => void savePermissions()}>
                          Save permissions
                        </Button>
                        <Button variant="outline" disabled={busy} onClick={() => setEditingTokenId(null)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
