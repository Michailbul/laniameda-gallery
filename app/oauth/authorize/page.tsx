import type { ReactNode } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAppUser } from "@/lib/server/app-user";
import type { AgentTokenScope } from "@/lib/server/agent-auth";
import {
  MCP_ACCESS_TOKEN_DAYS,
  isMcpAllowedUser,
  originFromHeaders,
  signConsentTicket,
  validateAuthorizeParams,
} from "@/lib/server/mcp-oauth";
import { OAuthSignIn } from "./oauth-sign-in";

export const metadata = {
  title: "Connect · Laniameda",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const SCOPE_COPY: Record<AgentTokenScope, { badge: string; text: string }> = {
  "gallery:read": { badge: "READ", text: "Search, browse and preview every piece, prompt and collection." },
  "gallery:write": { badge: "WRITE", text: "Save new pieces and prompts, edit tags, descriptions and collections." },
  "gallery:delete": { badge: "DELETE", text: "Remove pieces, prompts and collections." },
};

const hostOf = (uri: string) => {
  try {
    const url = new URL(uri);
    return url.host || `${url.protocol}//`;
  } catch {
    return uri;
  }
};

function Shell({ step, children }: { step: string; children: ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center bg-[var(--paper)] px-4 py-10 font-sans text-[var(--text-primary)]">
      <div className="w-full max-w-[440px]">
        <div className="mb-3 flex items-center justify-between font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--text-ghost)]">
          <span className="flex items-center gap-2">
            <span className="block h-[6px] w-[6px] rotate-45 bg-[var(--coral)]" />
            laniameda.gallery
          </span>
          <span>{step}</span>
        </div>
        <section className="border border-[var(--border-strong)] bg-[var(--surface-1)] shadow-[var(--shadow-brutal)]">
          {children}
        </section>
      </div>
    </main>
  );
}

function Title({ kicker, children }: { kicker: string; children: ReactNode }) {
  return (
    <header className="border-b border-[var(--border-default)] px-6 pb-5 pt-6">
      <p className="mb-2 font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--coral)]">
        {kicker}
      </p>
      <h1 className="text-[26px] font-bold uppercase leading-[1.02] tracking-[-0.02em]">{children}</h1>
    </header>
  );
}

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Shell step="MCP access">
      <Title kicker="Can't connect">{title}</Title>
      <div className="px-6 py-5 text-[13px] leading-relaxed text-[var(--text-secondary)]">{children}</div>
    </Shell>
  );
}

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") params.set(key, value);
  }

  const validation = await validateAuthorizeParams(params);
  if (!validation.ok) {
    if (validation.kind === "redirect") redirect(validation.location);
    return <Notice title="Unknown client">{validation.message} Start the connection again from your MCP client.</Notice>;
  }
  const authRequest = validation.request;

  const user = await getAppUser();
  if (!user) {
    return (
      <Shell step="1 / 2 · Sign in">
        <Title kicker="MCP access">Sign in to connect {authRequest.clientName}</Title>
        <OAuthSignIn />
      </Shell>
    );
  }

  if (!isMcpAllowedUser(user.ownerUserId)) {
    return (
      <Notice title="This MCP is private">
        You are signed in as {user.name ?? user.ownerUserId}. The gallery MCP only accepts its owner for now.
      </Notice>
    );
  }

  const ticket = await signConsentTicket(authRequest, user.ownerUserId);
  const origin = originFromHeaders(await headers());

  return (
    <Shell step="2 / 2 · Approve">
      <Title kicker="MCP access">Connect {authRequest.clientName} to your gallery</Title>

      <div className="flex flex-col gap-5 px-6 py-5">
        <dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-2.5 text-[12px]">
          <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-ghost)]">Client</dt>
          <dd className="font-semibold">{authRequest.clientName}</dd>
          <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-ghost)]">Returns to</dt>
          <dd>
            <code className="border border-[var(--border-default)] bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--text-secondary)]">
              {hostOf(authRequest.redirectUri)}
            </code>
          </dd>
          <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-ghost)]">Vault</dt>
          <dd className="flex items-center gap-2">
            {user.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.avatarUrl} alt="" className="h-5 w-5 border border-[var(--border-strong)] object-cover" />
            ) : null}
            <span className="font-semibold">{user.name ?? "Owner"}</span>
            <span className="font-mono text-[10px] text-[var(--text-ghost)]">{hostOf(origin)}</span>
          </dd>
        </dl>

        <ul className="flex flex-col border border-[var(--border-default)]">
          {authRequest.scopes.map((scope, index) => (
            <li
              key={scope}
              className={`flex items-start gap-3 px-3 py-2.5 ${index > 0 ? "border-t border-[var(--border-default)]" : ""}`}
            >
              <span
                className={`mt-[1px] w-[58px] shrink-0 border px-1.5 py-0.5 text-center font-mono text-[9px] font-semibold tracking-[0.14em] ${
                  scope === "gallery:delete"
                    ? "border-[var(--coral)] text-[var(--coral)]"
                    : "border-[var(--border-strong)] text-[var(--text-secondary)]"
                }`}
              >
                {SCOPE_COPY[scope].badge}
              </span>
              <span className="text-[12px] leading-snug text-[var(--text-secondary)]">{SCOPE_COPY[scope].text}</span>
            </li>
          ))}
        </ul>

        <form method="post" action="/api/oauth/authorize" className="flex flex-col gap-2.5">
          <input type="hidden" name="ticket" value={ticket} />
          <button type="submit" name="decision" value="approve" className="btn-brutal w-full py-3">
            Approve and connect
          </button>
          <button
            type="submit"
            name="decision"
            value="deny"
            className="w-full border border-[var(--border-strong)] py-2.5 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--text-tertiary)] transition-colors hover:border-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            Deny
          </button>
        </form>
      </div>

      <footer className="border-t border-[var(--border-default)] px-6 py-3.5 font-mono text-[10px] leading-relaxed tracking-[0.04em] text-[var(--text-ghost)]">
        Approving creates an agent token valid for {MCP_ACCESS_TOKEN_DAYS} days. Revoke it any time on{" "}
        <a href="/agents" className="text-[var(--text-tertiary)] underline underline-offset-2">
          /agents
        </a>
        .
      </footer>
    </Shell>
  );
}
