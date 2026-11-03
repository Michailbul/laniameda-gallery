"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ArrowLeft, Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { EDIT_MODELS, EDIT_PROVIDERS, type EditProvider } from "@/lib/edit-models";

type Check = { ok: boolean; message: string; balanceUsd?: number; credits?: number; account?: string };

const NAMES: Record<EditProvider, string> = { magnific: "Magnific", fal: "fal", pika: "Pika" };
const ABOUT: Record<EditProvider, string> = {
  magnific: "Runs on your own Magnific sign-in through its plugin. Edits land in the Magnific project named like the world.",
  fal: "API key. Krea 3, GPT Image 2.5 and Flux Kontext when Magnific cannot take the job.",
  pika: "API key. Seedream 5 Pro, GPT Image 2.5 and Nano Banana 2.1 when Magnific cannot take the job.",
};
const KEY_PAGE: Record<"fal" | "pika", string> = {
  fal: "https://fal.ai/dashboard/keys",
  pika: "https://pika.art/api",
};

const errorText = (error: unknown) =>
  error instanceof Error ? error.message.replace(/^.*ConvexError: /, "").split("\n")[0]! : "Something went wrong.";

/** The models a provider runs, first route or fallback. */
const modelsOn = (provider: EditProvider) =>
  EDIT_MODELS.filter((model) => model.routes.some((route) => route.provider === provider))
    .map((model) => ({ name: model.name, first: model.routes[0]!.provider === provider }));

/**
 * Settings: where in-place edits run. Magnific is a plugin connection (OAuth
 * on Michael's own account); fal and Pika are API keys. A key saved here wins
 * over the deployment's; nothing on this page ever shows a whole key.
 */
export function SettingsPage({ ownerUserId }: { ownerUserId: string }) {
  const rows = useQuery(api.providerCredentials.listProviderCredentials, { ownerUserId });
  const check = useAction(api.providerVault.checkProvider);
  const [checks, setChecks] = useState<Partial<Record<EditProvider, Check | "busy">>>({});
  const params = useSearchParams();
  const [banner, setBanner] = useState<{ text: string; bad?: boolean }>();

  const runCheck = async (provider: EditProvider) => {
    setChecks((current) => ({ ...current, [provider]: "busy" }));
    try {
      const result = await check({ ownerUserId, provider });
      setChecks((current) => ({ ...current, [provider]: result }));
    } catch (error) {
      setChecks((current) => ({ ...current, [provider]: { ok: false, message: errorText(error) } }));
    }
  };

  // Check everything that is set once on arrival: it is free and shows credit left.
  const checkedOnce = useRef(false);
  useEffect(() => {
    if (!rows || checkedOnce.current) return;
    checkedOnce.current = true;
    for (const row of rows) if (row.source !== "none") void runCheck(row.provider);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the rows first arrive
  }, [rows]);

  useEffect(() => {
    const state = params.get("magnific");
    if (state === "connected") setBanner({ text: `Magnific connected${params.get("account") ? ` as ${params.get("account")}` : ""}.` });
    else if (state === "error") setBanner({ text: params.get("why") || "Magnific could not connect.", bad: true });
    if (state) window.history.replaceState(null, "", "/settings");
  }, [params]);

  const byProvider = useMemo(() => new Map((rows ?? []).map((row) => [row.provider, row])), [rows]);

  return (
    <main className="lm-set">
      <nav className="lm-set-nav">
        <Link href="/" className="lm-set-back"><ArrowLeft size={13} aria-hidden />Gallery</Link>
        <Link href="/agents" className="lm-set-back">Agent tokens</Link>
      </nav>
      <header className="lm-set-head">
        <h1>Settings</h1>
        <p>Where edits in place run. The first one that has the model and credit takes the job; the rest wait as fallbacks.</p>
      </header>

      {banner && <p className={`lm-set-banner${banner.bad ? " bad" : ""}`} role="status">{banner.text}</p>}

      <section className="lm-set-section" aria-labelledby="edit-routes">
        <h2 id="edit-routes">Edit in place</h2>
        {!rows && <Loader2 className="animate-spin" size={16} style={{ color: "var(--lm-text-ghost)" }} aria-label="Loading" />}
        {rows && EDIT_PROVIDERS.map((provider, index) => (
          <ProviderRow key={provider} provider={provider} order={index + 1} ownerUserId={ownerUserId}
            row={byProvider.get(provider)} check={checks[provider]} onCheck={() => void runCheck(provider)}
            onChecked={(result) => setChecks((current) => ({ ...current, [provider]: result }))} />
        ))}
      </section>
    </main>
  );
}

type Row = FunctionReturnType<typeof api.providerCredentials.listProviderCredentials>[number];

function ProviderRow({ provider, order, ownerUserId, row, check, onCheck, onChecked }: {
  provider: EditProvider; order: number; ownerUserId: string; row?: Row;
  check?: Check | "busy"; onCheck: () => void; onChecked: (result: Check) => void;
}) {
  const save = useAction(api.providerVault.saveProviderKey);
  const remove = useMutation(api.providerCredentials.removeProviderCredential);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<"save" | "remove">();
  const models = modelsOn(provider);
  const set = row && row.source !== "none";
  const failed = check && check !== "busy" && !check.ok;

  const status = provider === "magnific"
    ? set ? `Connected${row?.account ? ` · ${row.account}` : ""}` : "Not connected"
    : row?.source === "app" ? `Key ···· ${row.hint ?? ""} · saved here`
    : row?.source === "server" ? "Server key" : "No key";

  const onSave = async () => {
    if (provider === "magnific" || !draft.trim()) return;
    setBusy("save");
    try {
      const result = await save({ ownerUserId, provider, key: draft });
      onChecked(result);
      if (result.ok) setDraft("");
    } catch (error) {
      onChecked({ ok: false, message: errorText(error) });
    } finally {
      setBusy(undefined);
    }
  };

  const onRemove = async () => {
    setBusy("remove");
    try {
      await remove({ ownerUserId, provider });
      onChecked({ ok: true, message: provider === "magnific" ? "Disconnected." : row?.serverKey ? "Removed. The server key takes over." : "Removed." });
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <article className={`lm-set-row${set && !failed ? " on" : ""}${failed ? " bad" : ""}`}>
      <span className="lm-set-order">{String(order).padStart(2, "0")}</span>
      <div className="lm-set-main">
        <div className="lm-set-title">
          <h3>{NAMES[provider]}</h3>
          <span className="lm-set-chip">{provider === "magnific" ? "Plugin" : "API key"}</span>
          <span className={`lm-set-state${set && !failed ? " on" : ""}`}>{status}</span>
        </div>
        <p className="lm-set-about">{ABOUT[provider]}</p>
        <p className="lm-set-models">
          {models.map((model) => <span key={model.name} className={model.first ? "first" : ""} title={model.first ? "Runs here first" : "Fallback"}>{model.name}</span>)}
        </p>

        {provider !== "magnific" && (
          <form className="lm-set-key" onSubmit={(event) => { event.preventDefault(); void onSave(); }}>
            <input type="password" autoComplete="off" spellCheck={false} value={draft} onChange={(event) => setDraft(event.target.value)}
              placeholder={set ? `Paste a new ${NAMES[provider]} key to replace it` : `Paste your ${NAMES[provider]} key`}
              aria-label={`${NAMES[provider]} API key`} />
            <button type="submit" className="lm-set-go" disabled={!draft.trim() || busy === "save"}>{busy === "save" ? "Checking" : "Save"}</button>
            <a href={KEY_PAGE[provider]} target="_blank" rel="noreferrer" className="lm-set-link">Get a key</a>
          </form>
        )}

        <div className="lm-set-actions">
          {provider === "magnific" && (
            <a href="/api/settings/magnific/start" className="lm-set-go">{set ? "Reconnect" : "Connect Magnific"}</a>
          )}
          {set && (
            <button type="button" className="lm-set-btn" disabled={check === "busy"} onClick={onCheck}>
              {check === "busy" ? "Checking" : "Check"}
            </button>
          )}
          {row?.source === "app" && (
            <button type="button" className="lm-set-btn" disabled={busy === "remove"} onClick={() => void onRemove()}>
              {provider === "magnific" ? "Disconnect" : "Remove"}
            </button>
          )}
          {check && check !== "busy" && <span className={`lm-set-msg${check.ok ? "" : " bad"}`} role="status">{check.message}</span>}
        </div>
      </div>
    </article>
  );
}
