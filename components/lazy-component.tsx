"use client";

import { useEffect, useState, type ComponentType, type ReactNode } from "react";

/**
 * A code-split component that never suspends. next/dynamic and React.lazy
 * suspend on the first render even when the chunk is already loaded, and
 * React 19 holds a revealed Suspense boundary back by ~300 ms, so a tap on
 * a preloaded modal still waited a third of a second. This renders the
 * component synchronously once its chunk is in (after `preload()` or an
 * earlier mount) and shows `fallback` only while the chunk is really on its
 * way. The import() inside `load` is still its own webpack chunk.
 */
export function lazyComponent<P extends object>(
  load: () => Promise<ComponentType<P>>,
  fallback: () => ReactNode = () => null,
) {
  let loaded: ComponentType<P> | null = null;
  let pending: Promise<ComponentType<P>> | null = null;
  const preload = () => {
    pending ??= load().then(
      (component) => (loaded = component),
      (error) => {
        pending = null; // a failed fetch can be retried by the next mount
        throw error;
      },
    );
    return pending;
  };

  function Lazy(props: P) {
    const [Component, setComponent] = useState<ComponentType<P> | null>(() => loaded);
    useEffect(() => {
      if (Component) return;
      let live = true;
      preload().then(
        (component) => { if (live) setComponent(() => component); },
        () => {},
      );
      return () => { live = false; };
    }, [Component]);
    return Component ? <Component {...props} /> : <>{fallback()}</>;
  }

  return Object.assign(Lazy, { preload });
}
