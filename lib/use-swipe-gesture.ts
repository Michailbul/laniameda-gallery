import { useRef, useCallback, useEffect } from "react";

interface SwipeHandlers {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  onSwipeDown?: () => void;
  onSwipeUp?: () => void;
  /** Called during touch-move with current delta from start. Return false to prevent default. */
  onDrag?: (dx: number, dy: number) => void;
  /** Called when touch ends without triggering a swipe (spring-back). */
  onDragCancel?: () => void;
}

const THRESHOLD = 50;
const MAX_TIME = 300;

export function useSwipeGesture(
  ref: React.RefObject<HTMLElement | null>,
  handlers: SwipeHandlers,
) {
  const startX = useRef(0);
  const startY = useRef(0);
  const startTime = useRef(0);
  const dragging = useRef(false);

  const onTouchStart = useCallback((e: TouchEvent) => {
    const touch = e.touches[0];
    startX.current = touch.clientX;
    startY.current = touch.clientY;
    startTime.current = Date.now();
    dragging.current = true;
  }, []);

  const onTouchMove = useCallback(
    (e: TouchEvent) => {
      if (!dragging.current || !handlers.onDrag) return;
      const touch = e.touches[0];
      const dx = touch.clientX - startX.current;
      const dy = touch.clientY - startY.current;
      handlers.onDrag(dx, dy);
    },
    [handlers],
  );

  const onTouchEnd = useCallback(
    (e: TouchEvent) => {
      dragging.current = false;
      const touch = e.changedTouches[0];
      const dx = touch.clientX - startX.current;
      const dy = touch.clientY - startY.current;
      const elapsed = Date.now() - startTime.current;

      if (elapsed > MAX_TIME || (Math.abs(dx) < THRESHOLD && Math.abs(dy) < THRESHOLD)) {
        handlers.onDragCancel?.();
        return;
      }

      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);

      if (absDx > absDy) {
        if (dx > 0) handlers.onSwipeRight?.();
        else handlers.onSwipeLeft?.();
      } else {
        if (dy > 0) handlers.onSwipeDown?.();
        else handlers.onSwipeUp?.();
      }
    },
    [handlers],
  );

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [ref, onTouchStart, onTouchMove, onTouchEnd]);
}
