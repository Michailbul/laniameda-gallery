// Privacy policy of the Save to Gallery Chrome extension. The Chrome Web Store
// listing links here, so the page is public and needs no sign-in.

export const metadata = {
  title: "Save to Gallery · Privacy",
  description: "What the Save to Gallery Chrome extension reads, sends and stores.",
};

const sections: { title: string; body: string[] }[] = [
  {
    title: "Who it is for",
    body: [
      "Save to Gallery is the companion extension of laniameda.gallery, a private image vault. It only works with a personal access token issued by the gallery's owner. Without that token it saves nothing and sends nothing.",
    ],
  },
  {
    title: "What it reads",
    body: [
      "When you choose to save something, the extension reads that item from the page you are on: the image or video address, its prompt and settings where the site shows them (for example Midjourney, X, Pinterest, Krea, Higgsfield, ShotDeck), the page address and the post text.",
      "On midjourney.com it reads the Imagine bar and your newest job, so a prompt you send from the queue is recorded with its job id.",
      "It does not read pages in the background, record browsing history, read forms, passwords or payment details, or track you across sites.",
    ],
  },
  {
    title: "Where data goes",
    body: [
      "Saved items and queue updates go only to the laniameda.gallery server (gallery.laniameda.space) over HTTPS, signed with your token. Nothing is sent to any other party, and nothing is sold, shared or used for advertising.",
    ],
  },
  {
    title: "What it stores in your browser",
    body: [
      "Your gallery address and token, your last save choices, Midjourney dock presets and key settings, kept in Chrome's extension storage (synced between your own Chrome profiles if Chrome sync is on). Removing the extension deletes them.",
    ],
  },
  {
    title: "Contact",
    body: ["Michael Buloichyk · mbuloichykai@gmail.com"],
  },
];

export default function ExtensionPrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16 text-[15px] leading-relaxed">
      <p className="font-mono text-xs uppercase tracking-widest opacity-60">laniameda.gallery · Chrome extension</p>
      <h1 className="mt-3 text-3xl font-extrabold uppercase tracking-tight">Save to Gallery · Privacy</h1>
      <p className="mt-2 font-mono text-xs opacity-60">Updated 9 Nov 2026</p>
      {sections.map((section) => (
        <section key={section.title} className="mt-10">
          <h2 className="text-sm font-bold uppercase tracking-wide">{section.title}</h2>
          {section.body.map((paragraph) => (
            <p key={paragraph} className="mt-3 opacity-80">
              {paragraph}
            </p>
          ))}
        </section>
      ))}
    </main>
  );
}
