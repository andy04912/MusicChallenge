import { useEffect } from "react";

// Safari can resize only the visual viewport when its keyboard opens.
// Keep the shell in that visible area, without treating pinch zoom as a keyboard.
export default function useMobileViewport(shell) {
  useEffect(() => {
    const viewport = window.visualViewport;
    const element = shell.current;
    if (!viewport || !element) return;
    let width = window.innerWidth;
    let restingHeight = window.innerHeight;
    let frame;
    let wasOpen = false;
    const reset = () => {
      delete element.dataset.keyboard;
      element.style.removeProperty("--keyboard-height");
      element.style.removeProperty("--keyboard-top");
      wasOpen = false;
    };
    const update = () => {
      const active = document.activeElement;
      const editing = active?.matches(
        'textarea, [contenteditable="true"], input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="button"]):not([type="submit"])',
      );
      if (width !== window.innerWidth) {
        width = window.innerWidth;
        restingHeight = window.innerHeight;
      }
      if (!editing) restingHeight = window.innerHeight;
      const mobile = width <= 1023;
      const open =
        mobile &&
        editing &&
        Math.abs(viewport.scale - 1) < 0.01 &&
        Math.max(restingHeight, window.innerHeight) - viewport.height > 120;
      if (!open) {
        reset();
        return;
      }
      element.dataset.keyboard = "open";
      element.style.setProperty("--keyboard-height", `${viewport.height}px`);
      element.style.setProperty("--keyboard-top", `${viewport.offsetTop}px`);
      if (!wasOpen) active.scrollIntoView?.({ block: "nearest" });
      wasOpen = true;
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    viewport.addEventListener("resize", schedule);
    viewport.addEventListener("scroll", schedule);
    window.addEventListener("resize", schedule);
    document.addEventListener("focusin", schedule);
    document.addEventListener("focusout", schedule);
    update();
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener("resize", schedule);
      viewport.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      document.removeEventListener("focusin", schedule);
      document.removeEventListener("focusout", schedule);
      reset();
    };
  }, [shell]);
}
