"use client";
/* eslint-disable @next/next/no-img-element -- this page is also served on another domain through a rewrite, so it uses plain <img> with srcset, never next/image. */

import { useCallback, useEffect, useRef, useState } from "react";
import { reviewBase } from "@/lib/review-client";

// Signed-out screen: the project title over one frame and a Google sign-in
// button (Google Identity Services, popup / One Tap). The credential goes to
// `${base}/api/auth/google`, which sets the review session; then the page
// reloads into the review. Invite links land here with ?invite=… on failure.

type GoogleId = {
  initialize: (options: Record<string, unknown>) => void;
  renderButton: (element: HTMLElement, options: Record<string, unknown>) => void;
  prompt: () => void;
  disableAutoSelect: () => void;
  cancel: () => void;
};

declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleId } };
  }
}

type Props = {
  title: string;
  subtitle?: string;
  cover?: { url: string; w: number; h: number };
  clientId: string;
  denied?: { email?: string };
  invite?: string;
  isDev: boolean;
};

const GSI_SRC = "https://accounts.google.com/gsi/client";

const loadGsi = () =>
  new Promise<GoogleId>((resolve, reject) => {
    const ready = () => (window.google?.accounts?.id ? resolve(window.google.accounts.id) : reject(new Error("Google sign-in did not load.")));
    if (window.google?.accounts?.id) return ready();
    let script = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SRC}"]`);
    if (!script) {
      script = document.createElement("script");
      script.src = GSI_SRC;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
    script.addEventListener("load", ready, { once: true });
    script.addEventListener("error", () => reject(new Error("Google sign-in did not load.")), { once: true });
  });

export function SignIn({ title, subtitle, cover, clientId, denied, invite, isDev }: Props) {
  const buttonRef = useRef<HTMLDivElement>(null);
  const [refused, setRefused] = useState<string | null>(denied ? denied.email ?? "This account" : null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [base, setBase] = useState("");

  const onCredential = useCallback(async (response: { credential?: string }) => {
    if (!response.credential) return;
    setBusy(true);
    setError(null);
    try {
      const result = await fetch(`${reviewBase()}/api/auth/google`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ credential: response.credential }),
      });
      const data = (await result.json().catch(() => null)) as { ok?: boolean; email?: string; error?: string } | null;
      if (result.ok && data?.ok) {
        window.location.replace(window.location.pathname);
        return;
      }
      if (result.status === 403) setRefused(data?.email ?? "This account");
      else setError(data?.error ?? "Sign-in did not work. Try again.");
    } catch {
      setError("Sign-in did not work. Check the connection and try again.");
    }
    setBusy(false);
  }, []);

  useEffect(() => {
    // Read the address only in the browser (the page may sit under another path).
    const handle = window.requestAnimationFrame(() => setBase(reviewBase()));
    return () => window.cancelAnimationFrame(handle);
  }, []);

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    loadGsi()
      .then((google) => {
        if (cancelled || !buttonRef.current) return;
        google.initialize({
          client_id: clientId,
          callback: onCredential,
          ux_mode: "popup",
          auto_select: false,
          itp_support: true,
          use_fedcm_for_prompt: true,
          cancel_on_tap_outside: true,
        });
        google.renderButton(buttonRef.current, {
          type: "standard",
          theme: "filled_black",
          size: "large",
          shape: "pill",
          text: "signin_with",
          logo_alignment: "left",
          width: 280,
          locale: "en",
        });
        if (!denied) google.prompt();
      })
      .catch((reason) => !cancelled && setError(reason instanceof Error ? reason.message : "Google sign-in did not load."));
    return () => {
      cancelled = true;
      window.google?.accounts?.id?.cancel();
    };
  }, [clientId, denied, onCredential]);

  const switchAccount = async () => {
    await fetch(`${reviewBase()}/api/auth/logout`, { method: "POST", credentials: "same-origin" }).catch(() => null);
    window.google?.accounts?.id?.disableAutoSelect();
    setRefused(null);
    setError(null);
    window.google?.accounts?.id?.prompt();
  };

  const devAs = async (as: "director" | "owner") => {
    if (as === "owner") await fetch("/api/auth/dev-login", { method: "POST" }).catch(() => null);
    await fetch(`${reviewBase()}/api/dev-as`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ as }) }).catch(() => null);
    window.location.replace(window.location.pathname);
  };

  const inviteMessage =
    invite === "invalid"
      ? "This invite link does not work. It may be incomplete or older than 30 days. Ask Michael for a new one."
      : invite === "revoked"
        ? "This invite link is no longer active for this review. Ask Michael for a new one."
        : null;

  return (
    <div className="rv-signin">
      {cover ? (
                <img className="cover" src={cover.url} width={cover.w} height={cover.h} alt="" fetchPriority="high" decoding="async" />
      ) : null}
      <div className="box">
        <div className="kick">Director review</div>
        <h1>{title}</h1>
        <p className="sub">{subtitle?.trim() || "Art direction frames for review. Sign in to look, like and comment."}</p>

        <div className="act">
          {inviteMessage && !refused ? <div className="msg err">{inviteMessage}</div> : null}
          {refused ? (
            <>
              <div className="msg err">
                <b>{refused}</b> has no access to this review. Ask Michael to add it.
              </div>
              <button type="button" className="rv-btn solid" onClick={() => void switchAccount()}>Use another account</button>
            </>
          ) : null}
          {clientId ? (
            <div ref={buttonRef} style={{ display: refused ? "none" : "block", minHeight: 44, opacity: busy ? 0.5 : 1 }} />
          ) : (
            <div className="msg">Google sign-in is not switched on yet. Open the private link Michael sent you, or ask him for one.</div>
          )}
          {busy ? <div className="msg">Signing in…</div> : null}
          {error ? <div className="msg err">{error}</div> : null}
          {isDev ? (
            <div className="dev">
              <button type="button" className="rv-btn" onClick={() => void devAs("owner")}>Dev · owner</button>
              <button type="button" className="rv-btn" onClick={() => void devAs("director")}>Dev · test director</button>
            </div>
          ) : null}
        </div>

        <div className="foot">
          <span>Laniameda</span>
          <a href={base ? `${base}/privacy` : "privacy"}>Privacy</a>
        </div>
      </div>
    </div>
  );
}
