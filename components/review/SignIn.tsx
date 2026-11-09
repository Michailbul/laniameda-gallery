"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { reviewBase } from "@/lib/review-client";

// The sign-in card. It floats (glass) over the blurred review behind it
// (TeaserBackdrop, rendered by the server). Google Identity Services gives a
// credential that goes to `${base}/api/auth/google`, which sets the review
// session; then the page reloads into the review. Invite links land here
// with ?invite=… when they fail.

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
  roundLine?: string;
  clientId: string;
  denied?: { email?: string };
  invite?: string;
  isDev: boolean;
  /** Any Google account may sign in. */
  openSignIn?: boolean;
  /** The director's first name, on the Director door ("Alejandro"). */
  directorName?: string;
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

export function SignIn({ title, subtitle, roundLine, clientId, denied, invite, isDev, openSignIn, directorName }: Props) {
  const buttonRef = useRef<HTMLDivElement>(null);
  const [refused, setRefused] = useState<string | null>(denied ? denied.email ?? "This account" : null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [base, setBase] = useState("");
  // The two doors: directors like and comment; guests look.
  const [door, setDoor] = useState<"director" | "guest">("director");
  const doorRef = useRef(door);
  const pickDoor = (value: "director" | "guest") => {
    doorRef.current = value;
    setDoor(value);
  };
  const [notice, setNotice] = useState<string | null>(null);

  const onCredential = useCallback(async (response: { credential?: string }) => {
    if (!response.credential) return;
    setBusy(true);
    setError(null);
    try {
      const result = await fetch(`${reviewBase()}/api/auth/google`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ credential: response.credential, as: doorRef.current }),
      });
      const data = (await result.json().catch(() => null)) as
        | { ok?: boolean; email?: string; error?: string; role?: string; wantsDirector?: boolean }
        | null;
      if (result.ok && data?.ok) {
        if (data.wantsDirector) {
          // Not on the director list with this account: in as a guest now,
          // and Michael sees the request to switch it.
          setNotice(`${data.email ?? "This account"} is not on the director list yet. You're in as a guest for now, and Michael has been asked to make you a director.`);
          window.setTimeout(() => window.location.replace(window.location.pathname), 4500);
          return;
        }
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
          width: 300,
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

  const devAs = async (as: "director" | "producer" | "owner") => {
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
    <div className="rv-card">
      <div className="kick">Art direction review{roundLine ? ` · ${roundLine}` : ""}</div>
      <h1>{title}</h1>
      <p className="sub">
        {subtitle?.trim() && !/^art direction review$/i.test(subtitle.trim()) ? `${subtitle.trim()}. ` : ""}
        {!openSignIn
          ? "Sign in with the Google account Michael invited to look, like and comment."
          : door === "director"
            ? `${directorName ? `${directorName}, sign in` : "Sign in"} with your Google account, or open the invite link Michael sent.`
            : "Sign in with any Google account to look at the frames."}
      </p>

      {openSignIn ? (
        <div className="rv-doors" role="radiogroup" aria-label="Sign in as">
          <button type="button" role="radio" aria-checked={door === "director"} onClick={() => pickDoor("director")}>
            <b>{directorName ?? "Director"}</b>
            <span>{directorName ? "Director · like and comment" : "Like and comment"}</span>
          </button>
          <button type="button" role="radio" aria-checked={door === "guest"} onClick={() => pickDoor("guest")}>
            <b>Guest</b>
            <span>Look only</span>
          </button>
        </div>
      ) : null}

      <div className="act">
        {notice ? <div className="msg">{notice}</div> : null}
        {inviteMessage && !refused ? <div className="msg err">{inviteMessage}</div> : null}
        {refused ? (
          <>
            <div className="msg err">
              <b>{refused}</b> has no access to this review. {openSignIn ? "Try again, or ask Michael for an invite link." : "Ask Michael to add it, or open the invite link he sent."}
            </div>
            <button type="button" className="rv-btn solid" onClick={() => void switchAccount()}>Use another account</button>
          </>
        ) : null}
        {clientId ? (
          // A light colour scheme keeps Google's iframe transparent (no white box).
          <div ref={buttonRef} className="rv-gsi" style={{ display: refused ? "none" : undefined, opacity: busy ? 0.5 : 1 }} />
        ) : (
          <div className="msg">Google sign-in is not switched on yet. Open the private link Michael sent you, or ask him for one.</div>
        )}
        {busy ? <div className="msg">Signing in…</div> : null}
        {error ? <div className="msg err">{error}</div> : null}
        {isDev ? (
          <div className="dev">
            <button type="button" className="rv-btn" onClick={() => void devAs("owner")}>Dev · owner</button>
            <button type="button" className="rv-btn" onClick={() => void devAs("director")}>Dev · director</button>
            <button type="button" className="rv-btn" onClick={() => void devAs("producer")}>Dev · producer</button>
          </div>
        ) : null}
      </div>

      <div className="foot">
        <span>Michael Buloichyk · Art direction</span>
        <span>
          <a href={base ? `${base}/privacy` : "privacy"}>Privacy</a>
        </span>
      </div>
    </div>
  );
}
