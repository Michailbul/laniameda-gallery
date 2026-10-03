"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";

// The page's password prompt. The URL stays as it is, so a shared link opens
// the page it points at once the password is in.
export function YouTubeGate() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [state, setState] = useState<"idle" | "checking" | "wrong" | "error">("idle");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!password.trim() || state === "checking") return;
    setState("checking");
    try {
      const response = await fetch("/api/youtube/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (response.ok) {
        router.refresh();
        return;
      }
      setState(response.status === 401 ? "wrong" : "error");
    } catch {
      setState("error");
    }
  };

  return (
    <main className="yt-gate">
      <form className="yt-gate-card" onSubmit={submit}>
        <span className="yt-gate-icon" aria-hidden>
          <Lock className="h-4 w-4" />
        </span>
        <h1 className="yt-title">YouTube</h1>
        <p className="yt-gate-copy">A private collection of channels and videos. Enter the password to open it.</p>
        <input
          className="yt-input"
          type="password"
          autoFocus
          autoComplete="off"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            if (state !== "checking") setState("idle");
          }}
          placeholder="Password"
          aria-label="Password"
          aria-invalid={state === "wrong"}
        />
        <button className="yt-button yt-button-primary" type="submit" disabled={state === "checking"}>
          {state === "checking" ? "Checking" : "Open"}
        </button>
        <p className="yt-gate-error" role="alert">
          {state === "wrong" ? "That is not the password." : state === "error" ? "Could not check. Try again." : ""}
        </p>
      </form>
    </main>
  );
}
