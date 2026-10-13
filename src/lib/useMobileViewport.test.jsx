import { useRef } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import useMobileViewport from "./useMobileViewport.js";

let viewport;
function Harness() {
  const shell = useRef(null);
  useMobileViewport(shell);
  return (
    <div ref={shell} data-testid="shell">
      <input aria-label="Answer" />
    </div>
  );
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("innerWidth", 390);
  vi.stubGlobal("innerHeight", 844);
  viewport = Object.assign(new EventTarget(), {
    height: 844,
    offsetTop: 0,
    scale: 1,
  });
  vi.stubGlobal("visualViewport", viewport);
  vi.stubGlobal("requestAnimationFrame", (callback) => setTimeout(callback, 0));
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function resize(height, layoutHeight = 844) {
  act(() => {
    viewport.height = height;
    window.innerHeight = layoutHeight;
    viewport.dispatchEvent(new Event("resize"));
    vi.runAllTimers();
  });
}
function focus() {
  act(() => {
    screen.getByLabelText("Answer").focus();
    vi.runAllTimers();
  });
}
test("Safari keyboard uses the visible height and restores the shell on dismissal", () => {
  render(<Harness />);
  const shell = screen.getByTestId("shell");
  focus();
  viewport.offsetTop = 22;
  resize(460);
  expect(shell.dataset.keyboard).toBe("open");
  expect(shell.style.getPropertyValue("--keyboard-height")).toBe("460px");
  expect(shell.style.getPropertyValue("--keyboard-top")).toBe("22px");
  resize(844);
  expect(shell.dataset.keyboard).toBeUndefined();
  expect(shell.style.getPropertyValue("--keyboard-height")).toBe("");
});
test("Android layout resizing still recognizes the keyboard; orientation and blur reset it", () => {
  render(<Harness />);
  const shell = screen.getByTestId("shell");
  focus();
  resize(460, 460);
  expect(shell.dataset.keyboard).toBe("open");
  window.innerWidth = 844;
  resize(390, 390);
  expect(shell.dataset.keyboard).toBeUndefined();
  resize(190, 390);
  expect(shell.dataset.keyboard).toBe("open");
  act(() => {
    screen.getByLabelText("Answer").blur();
    vi.runAllTimers();
  });
  expect(shell.dataset.keyboard).toBeUndefined();
});
test("pinch zoom and browser toolbar resizing do not hide navigation", () => {
  render(<Harness />);
  const shell = screen.getByTestId("shell");
  resize(730);
  expect(shell.dataset.keyboard).toBeUndefined();
  focus();
  viewport.scale = 2;
  resize(422);
  expect(shell.dataset.keyboard).toBeUndefined();
});
