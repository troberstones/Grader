"use client";

import { useCallback, useLayoutEffect, useState } from "react";

/**
 * The live content width of an element, for picking a layout tier.
 *
 * Measured in a layout effect so the first paint already uses the right tier
 * rather than flashing the widest one. `null` until the element mounts.
 *
 * Only meaningful on an element whose width does not depend on its contents
 * (a flex child with a zero basis, a fixed column); otherwise a tier change
 * resizes the element and the tier flips back, forever.
 */
export function useElementWidth<T extends HTMLElement>(): [(el: T | null) => void, number | null] {
  const [el, setEl] = useState<T | null>(null);
  const [width, setWidth] = useState<number | null>(null);
  const ref = useCallback((node: T | null) => setEl(node), []);

  useLayoutEffect(() => {
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);

  return [ref, width];
}
