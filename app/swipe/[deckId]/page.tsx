import { redirect } from "next/navigation";

// Swipe decks became stacks in the world Inbox ("Decisions").
export default function SwipeDeckPage() {
  redirect("/inbox");
}
