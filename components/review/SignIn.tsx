"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { reviewBase } from "@/lib/review-client";

// The sign-in card. It floats (glass) over the blurred review behind it
// (TeaserBackdrop, rendered by the server). One door per person who gives
// feedback ("Alejandro · Director", "Lukáš · Producer") and a Guest door.
// A person's door shows the Google button; its credential goes to
// `${base}/api/auth/google` with the door's id, which sets the review session.
// Guest needs no account: `${base}/api/auth/guest` sets a looking-only
// session. Then the page reloads into the review. Invite links land here with
// ?invite=… when they fail. No One Tap: nothing signs in before a door is
// picked.

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

type Door = { who: string; name: string; title: string };

type Props = {
  title: string;
  clientId: string;
  denied?: { email?: string };
  invite?: string;
  isDev: boolean;
  /** Guests may look without signing in. */
  openSignIn?: boolean;
  /** One door per person who gives feedback. */
  people: Door[];
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

export function SignIn({ title, clientId, denied, invite, isDev, openSignIn, people }: Props) {
  const buttonRef = useRef<HTMLDivElement>(null);
  const [refused, setRefused] = useState<string | null>(denied ? `${denied.email ?? "This account"} has no access to this review.` : null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The picked door: a person's id, "guest", or nothing yet.
  const [door, setDoor] = useState<string | null>(null);
  const doorRef = useRef<string | null>(null);
  const pick = (value: string) => {
    doorRef.current = value;
    setDoor(value);
    setRefused(null);
    setError(null);
  };

  // eslint-disable-next-line react-hooks/preserve-manual-memoization -- reads the picked door from a ref so Google's callback stays the same function
  const onCredential = useCallback(async (response: { credential?: string }) => {
    if (!response.credential || !doorRef.current || doorRef.current === "guest") return;
    setBusy(true);
    setError(null);
    try {
      const result = await fetch(`${reviewBase()}/api/auth/google`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ credential: response.credential, who: doorRef.current }),
      });
      const data = (await result.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (result.ok && data?.ok) {
        window.location.replace(window.location.pathname);
        return;
      }
      if (result.status === 403) setRefused(data?.error ?? "This account has no access to this review.");
      else setError(data?.error ?? "Sign-in did not work. Try again.");
    } catch {
      setError("Sign-in did not work. Check the connection and try again.");
    }
    setBusy(false);
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
      })
      .catch((reason) => !cancelled && setError(reason instanceof Error ? reason.message : "Google sign-in did not load."));
    return () => {
      cancelled = true;
      window.google?.accounts?.id?.cancel();
    };
  }, [clientId, onCredential]);

  const asGuest = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await fetch(`${reviewBase()}/api/auth/guest`, { method: "POST", credentials: "same-origin" });
      const data = (await result.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (result.ok && data?.ok) {
        window.location.replace(window.location.pathname);
        return;
      }
      setError(data?.error ?? "Could not open the review. Try again.");
    } catch {
      setError("Could not open the review. Check the connection and try again.");
    }
    setBusy(false);
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
  const person = people.find((row) => row.who === door);

  return (
    <div className="rv-card">
      <div className="kick">Art direction review</div>
      <h1>{title}</h1>

      <div className="rv-doors" role="radiogroup" aria-label="Sign in as" data-n={people.length + (openSignIn ? 1 : 0)}>
        {people.map((row) => (
          <button key={row.who} type="button" role="radio" aria-checked={door === row.who} onClick={() => pick(row.who)}>
            <b>{row.name}</b>
            <span>{row.title}</span>
          </button>
        ))}
        {openSignIn ? (
          <button type="button" role="radio" aria-checked={door === "guest"} onClick={() => pick("guest")}>
            <b>Guest</b>
            <span>Look only</span>
          </button>
        ) : null}
      </div>

      <div className="act">
        {inviteMessage && !refused ? <div className="msg err">{inviteMessage}</div> : null}
        {refused ? <div className="msg err">{refused}</div> : null}
        {clientId ? (
          // Rendered once and shown under a person's door. A light colour
          // scheme keeps Google's iframe transparent (no white box).
          <div
            ref={buttonRef}
            className="rv-gsi"
            aria-label={person ? `Sign in as ${person.name} with Google` : undefined}
            style={{ display: person ? undefined : "none", opacity: busy ? 0.5 : 1 }}
          />
        ) : person ? (
          <div className="msg">Google sign-in is not switched on yet. Open the invite link Michael sent you.</div>
        ) : null}
        {door === "guest" ? (
          <button type="button" className="rv-btn solid rv-guest-go" disabled={busy} onClick={() => void asGuest()}>
            {busy ? "Opening…" : "Continue as guest"}
          </button>
        ) : null}
        {busy && person ? <div className="msg">Signing in…</div> : null}
        {error ? <div className="msg err">{error}</div> : null}
        {isDev ? (
          <div className="dev">
            <button type="button" className="rv-btn" onClick={() => void devAs("owner")}>Dev · owner</button>
            <button type="button" className="rv-btn" onClick={() => void devAs("director")}>Dev · director</button>
            <button type="button" className="rv-btn" onClick={() => void devAs("producer")}>Dev · producer</button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
