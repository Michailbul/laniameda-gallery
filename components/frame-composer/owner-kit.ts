// What only the signed-in owner uses on a frame: the note box (C, V), the
// like key's double-press logic (1) and the confirmation a key paints. One
// chunk with its styles, fetched once the owner is known, so a visitor's
// first load carries none of it.
import "./frame-composer.css";
import "./frame-flash.css";

export { FrameComposer } from "./frame-composer";
export { flashFrame } from "@/lib/frame-flash";
export { createLikePresses, likeFlash } from "@/lib/like-presses";
