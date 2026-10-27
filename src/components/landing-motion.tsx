"use client";

import { useEffect, useRef, type ReactNode } from "react";

export function LandingMotion({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!root.current || !("IntersectionObserver" in window) || !("animate" in Element.prototype)) return;

    const container = root.current;
    const elements = [...container.querySelectorAll<HTMLElement>("[data-reveal]")];
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const revealed = new WeakSet<HTMLElement>();
    const animations = new Set<Animation>();
    let observer: IntersectionObserver | undefined;

    function animate(element: HTMLElement, id: string, keyframes: Keyframe[], timing: KeyframeAnimationOptions) {
      const animation = element.animate(keyframes, {
        easing: "cubic-bezier(0.16, 1, 0.3, 1)",
        fill: "backwards",
        ...timing,
      });
      animation.id = id;
      animations.add(animation);
      animation.onfinish = animation.oncancel = () => { animations.delete(animation); };
    }

    function reveal(element: HTMLElement) {
      delete element.dataset.revealPending;
      element.dataset.revealed = "";
      revealed.add(element);
      if (element.contains(document.activeElement)) return;

      const lines = [...element.querySelectorAll<HTMLElement>("[data-hero-line]")];
      if (lines.length > 0) {
        lines.forEach((line, index) => {
          animate(line, `landing-hero-line-${index + 1}`, [
            { opacity: 0, transform: "translateY(28px)", clipPath: "inset(0 0 100% 0)" },
            { opacity: 1, transform: "translateY(0)", clipPath: "inset(0 0 0% 0)" },
          ], { duration: 820, delay: 100 + index * 140 });
        });
        element.querySelectorAll<HTMLElement>("[data-hero-part]").forEach((part, index) => {
          animate(part, `landing-hero-${part.dataset.heroPart}`, [
            { opacity: 0, transform: "translateY(14px)" },
            { opacity: 1, transform: "translateY(0)" },
          ], { duration: 600, delay: index === 0 ? 0 : 280 + index * 100 });
        });
      } else if (element.hasAttribute("data-preview-shell")) {
        animate(element, "landing-preview-arrival", [
          { opacity: 0, transform: "translateY(32px) scale(0.96)" },
          { opacity: 1, transform: "translateY(0) scale(1)" },
        ], { duration: 900, delay: 160 });
      } else {
        animate(element, "landing-scroll-reveal", [
          { opacity: 0, transform: "translateY(24px)" },
          { opacity: 1, transform: "translateY(0)" },
        ], { duration: 650, delay: Number(element.dataset.reveal ?? 0) * 90 });
      }
    }

    function clear() {
      observer?.disconnect();
      animations.forEach((animation) => animation.cancel());
      animations.clear();
      elements.forEach((element) => { delete element.dataset.revealPending; });
    }

    function keepFocusVisible(event: FocusEvent) {
      // Pointer focus must not move a control between pressing and releasing it.
      if (!(event.target instanceof Element) || !event.target.matches(":focus-visible")) return;
      const focused = event.target;
      animations.forEach((animation) => {
        const effect = animation.effect;
        if (effect instanceof KeyframeEffect && effect.target instanceof Element && effect.target.contains(focused)) {
          animation.cancel();
        }
      });
    }

    function configure() {
      clear();
      if (preference.matches) return;

      observer = new IntersectionObserver((entries) => {
        if (preference.matches) return;
        entries.forEach((entry) => {
          if (!entry.isIntersecting || !(entry.target instanceof HTMLElement)) return;
          reveal(entry.target);
          observer?.unobserve(entry.target);
        });
      }, { threshold: 0.08, rootMargin: "0px 0px -24px 0px" });

      elements.forEach((element) => {
        if (revealed.has(element)) return;
        const bounds = element.getBoundingClientRect();
        if (bounds.height === 0 || bounds.bottom <= 0) return;
        if (bounds.top < window.innerHeight) {
          reveal(element);
        } else {
          element.dataset.revealPending = "";
          observer?.observe(element);
        }
      });
    }

    configure();
    container.addEventListener("focusin", keepFocusVisible);
    preference.addEventListener("change", configure);
    return () => {
      container.removeEventListener("focusin", keepFocusVisible);
      preference.removeEventListener("change", configure);
      clear();
    };
  }, []);

  return <div ref={root} data-landing-motion className="contents">{children}</div>;
}
