import { describe, expect, test } from "bun:test";
import { composeRoundMail } from "../convex/reviewMail";

const data = {
  title: "CASSANDRA",
  publicUrl: "https://www.mishabuloichyk.com/cassandra",
  slug: "cassandra",
  label: "v0.2",
  roundTitle: "All styles",
  note: "Every look we are trying, across the places.",
  frames: 520,
  fresh: 489,
  styles: 25,
  reviewers: [{ email: "director@example.com", name: "Alex Director" }],
};

describe("round email", () => {
  test("greets by first name and links to the public review", () => {
    const mail = composeRoundMail(data, data.reviewers[0]!);
    expect(mail.subject).toBe("CASSANDRA · new round to review · All styles");
    expect(mail.html).toContain("Hi Alex,");
    expect(mail.html).toContain('href="https://www.mishabuloichyk.com/cassandra"');
    expect(mail.text).toContain("520 frames in 25 styles, 489 of them new.");
    expect(mail.html).toContain("Every look we are trying");
  });

  test("escapes the note and falls back to the gallery address", () => {
    const mail = composeRoundMail({ ...data, publicUrl: undefined, note: "<b>bold</b>", fresh: 520 }, { email: "pat@example.com" });
    expect(mail.html).toContain("&lt;b&gt;bold&lt;/b&gt;");
    expect(mail.html).toContain("Hi pat,");
    expect(mail.text).toContain("https://gallery.laniameda.space/review/cassandra");
    expect(mail.text).not.toContain("of them new");
  });
});
