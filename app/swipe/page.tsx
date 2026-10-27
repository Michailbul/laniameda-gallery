import { redirect } from "next/navigation";

// Swipe decks became the world Inbox ("Decisions").
export default function SwipePage() {
  redirect("/inbox");
}
