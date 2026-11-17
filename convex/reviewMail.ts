import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

// Email the reviewers when Michael sends a round (Michael, 17 Nov 2026: "can
// we pls integrate the email notification that there are updates"). The mail
// goes out from Michael's own Gmail through ClawLink, so a producer gets a
// plain note from him with one button to the review, never a no-reply robot.
//
// Convex env: CLAWLINK_API_KEY (ClawLink key) and REVIEW_MAIL_CONNECTION
// (the ClawLink Gmail connection id to send from). Without them nothing is
// sent and the log says so.

const CLAWLINK = "https://claw-link.dev";

const escape = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const firstName = (name?: string, email?: string) =>
  (name?.trim().split(/\s+/)[0] || email?.split("@")[0] || "").trim();

type MailData = {
  title: string;
  publicUrl?: string;
  slug: string;
  label: string;
  roundTitle?: string;
  note?: string;
  frames: number;
  fresh: number;
  styles: number;
  reviewers: Array<{ email: string; name?: string }>;
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export const composeRoundMail = (data: MailData, reviewer: { email: string; name?: string }) => {
  const url = data.publicUrl || `https://gallery.laniameda.space/review/${data.slug}`;
  const hi = firstName(reviewer.name, reviewer.email);
  const what = [
    plural(data.frames, "frame"),
    data.styles > 1 ? `in ${plural(data.styles, "style")}` : "",
  ].filter(Boolean).join(" ");
  const fresh = data.fresh && data.fresh < data.frames ? `, ${data.fresh} of them new` : "";
  const subject = `${data.title} · new round to review${data.roundTitle ? ` · ${data.roundTitle}` : ""}`;
  const lead = `A new round of the ${data.title} art direction is up: ${what}${fresh}.`;
  const text = [
    `Hi ${hi},`,
    "",
    lead,
    ...(data.note ? ["", data.note] : []),
    "",
    `Open the review: ${url}`,
    "",
    "Like or dislike frames and whole styles, and leave comments right on them. A short tour shows how it works.",
    "",
    "Michael",
  ].join("\n");
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f4efe9;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4efe9;padding:32px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#191919;border-radius:14px;padding:32px 30px;font-family:Inter,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;color:#FFF4EA;">
<tr><td style="font:600 11px/1.4 'JetBrains Mono',Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:rgba(255,244,234,.55);padding-bottom:14px;">${escape(data.title)} · ${escape(data.label)}${data.roundTitle ? ` · ${escape(data.roundTitle)}` : ""}</td></tr>
<tr><td style="font:800 22px/1.25 Inter,-apple-system,Helvetica,Arial,sans-serif;text-transform:uppercase;letter-spacing:.01em;padding-bottom:16px;">New round to review</td></tr>
<tr><td style="font:400 15px/1.6 Inter,-apple-system,Helvetica,Arial,sans-serif;color:rgba(255,244,234,.88);padding-bottom:${data.note ? 12 : 22}px;">Hi ${escape(hi)},<br>${escape(lead)}</td></tr>
${data.note ? `<tr><td style="font:400 15px/1.6 Inter,-apple-system,Helvetica,Arial,sans-serif;color:rgba(255,244,234,.88);padding-bottom:22px;white-space:pre-line;">${escape(data.note)}</td></tr>` : ""}
<tr><td style="padding-bottom:24px;"><a href="${escape(url)}" style="display:inline-block;background:#F26157;color:#191919;text-decoration:none;font:700 14px/1 Inter,-apple-system,Helvetica,Arial,sans-serif;padding:14px 22px;border-radius:999px;">Open the review</a></td></tr>
<tr><td style="font:400 13px/1.6 Inter,-apple-system,Helvetica,Arial,sans-serif;color:rgba(255,244,234,.6);padding-bottom:18px;">Like or dislike frames and whole styles, and leave comments right on them. A short tour shows how it works.</td></tr>
<tr><td style="font:600 14px/1.4 Inter,-apple-system,Helvetica,Arial,sans-serif;color:#FFF4EA;">Michael</td></tr>
</table>
</td></tr></table></body></html>`;
  return { subject, text, html };
};

const sendGmail = async (to: string, subject: string, body: string, isHtml: boolean) => {
  const key = process.env.CLAWLINK_API_KEY;
  const connection = process.env.REVIEW_MAIL_CONNECTION;
  if (!key || !connection) return { ok: false, reason: "CLAWLINK_API_KEY or REVIEW_MAIL_CONNECTION is not set" };
  const response = await fetch(`${CLAWLINK}/api/tools/gmail_send_email/execute`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      "x-clawlink-capabilities": "offload, confirm-high-impact",
      "user-agent": "laniameda-review/1.0",
    },
    body: JSON.stringify({
      connectionId: Number(connection),
      arguments: { user_id: "me", recipient_email: to, subject, body, is_html: isHtml },
    }),
  });
  const body = await response.text();
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { parsed = undefined; }
  const result = (parsed as { result?: { successful?: boolean; error?: string } } | undefined)?.result;
  const ok = response.ok && result?.successful !== false;
  return { ok, reason: ok ? undefined : `${response.status} ${body.slice(0, 300)}` };
};

/** A round was sent: one email to each reviewer. */
export const roundPublished = internalAction({
  args: { projectId: v.id("reviewProjects"), versionId: v.id("reviewVersions"), only: v.optional(v.array(v.string())) },
  returns: v.object({ sent: v.number(), failed: v.number() }),
  handler: async (ctx, args) => {
    const data = (await ctx.runQuery(internal.review.roundMailData, { projectId: args.projectId, versionId: args.versionId })) as MailData | null;
    if (!data) return { sent: 0, failed: 0 };
    const only = args.only?.map((row) => row.toLowerCase());
    const to = only
      ? only.map((email) => data.reviewers.find((row) => row.email.toLowerCase() === email) ?? { email })
      : data.reviewers;
    let sent = 0;
    let failed = 0;
    for (const reviewer of to) {
      const mail = composeRoundMail(data, reviewer);
      // A plain note from Michael's Gmail: an HTML-only card with a button
      // went to Spam in the 17 Nov test, a person's plain mail does not.
      const result = await sendGmail(reviewer.email, mail.subject, mail.text, false);
      if (result.ok) sent += 1;
      else {
        failed += 1;
        console.error(`Round email to ${reviewer.email} failed: ${result.reason}`);
      }
    }
    console.log(`Round email ${data.label}: ${sent} sent, ${failed} failed`);
    return { sent, failed };
  },
});
