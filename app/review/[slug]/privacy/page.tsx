import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy · Director review",
  description: "Art direction review.",
  robots: { index: false },
};

// The privacy note Google's sign-in consent screen links to
// (www.mishabuloichyk.com/cassandra/privacy). Plain and short.
export default function ReviewPrivacyPage() {
  const paragraph = { margin: "0 0 14px", lineHeight: 1.6, color: "rgba(255,244,234,0.78)" } as const;
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#0A0805",
        color: "#FFF4EA",
        fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
        padding: "72px 24px",
      }}
    >
      <div style={{ maxWidth: 640, margin: "0 auto", fontSize: 15 }}>
        <p style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11, letterSpacing: "0.12em", color: "rgba(255,244,234,0.5)", margin: "0 0 12px" }}>
          DIRECTOR REVIEW
        </p>
        <h1 style={{ fontWeight: 800, fontSize: 28, letterSpacing: "0.02em", textTransform: "uppercase", margin: "0 0 28px" }}>Privacy</h1>
        <p style={paragraph}>
          This review page shows unreleased artwork to the people Michael Buloichyk invites. When you sign in with Google,
          we receive your name, email address and profile picture from Google. We use them only to check that you were
          invited and to show who left which comment.
        </p>
        <p style={paragraph}>
          We store your email, your name, the time of your last visit, and the feedback you give here (likes, dislikes
          and comments) so the art team can act on it. Nothing is sold or shared with anyone outside the production,
          and nothing is used for advertising.
        </p>
        <p style={paragraph}>
          The data is kept on Convex (database) and Vercel (hosting) for as long as the production needs it. To see,
          correct or delete what we hold about you, write to mbuloichykai@gmail.com and it will be done within 30 days.
        </p>
        <p style={{ ...paragraph, color: "rgba(255,244,234,0.5)", fontSize: 13 }}>Last updated 6 November 2026.</p>
      </div>
    </main>
  );
}
