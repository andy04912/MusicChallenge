import { expect, test, vi } from "vitest";
import { Profiler } from "react";
import { render, screen, act } from "@testing-library/react";
import ScoreRoll from "./ScoreRoll.jsx";

test("reduced motion shows the final score immediately with stable accessible text", () => {
  vi.spyOn(window, "matchMedia").mockReturnValue({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  });
  render(<ScoreRoll points={800} previousTotal={1000} total={1800} />);
  expect(screen.getByText("1,800")).toBeInTheDocument();
  expect(screen.getByText("累積得分")).toBeInTheDocument();
  expect(
    screen.getByLabelText("本題 800 分，累積 1800 分"),
  ).toBeInTheDocument();
});
test("normal motion first presents this round's points", () => {
  render(<ScoreRoll points={800} previousTotal={1000} total={1800} />);
  expect(screen.getByText("+800")).toBeInTheDocument();
  expect(screen.getByText("本題得分")).toBeInTheDocument();
});

test("round points roll into the total without per-frame React commits", () => {
  vi.useFakeTimers();
  let tick;
  const commits = vi.fn();
  vi.spyOn(performance, "now").mockReturnValue(100);
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    tick = callback;
    return 1;
  });
  const { unmount } = render(
    <Profiler id="score" onRender={commits}>
      <ScoreRoll points={800} previousTotal={1000} total={1800} />
    </Profiler>,
  );
  expect(screen.getByText("+800")).toBeInTheDocument();
  act(() => vi.advanceTimersByTime(950));
  expect(screen.getByText("累積得分")).toBeInTheDocument();
  expect(screen.getByText("1,000")).toBeInTheDocument();
  act(() => tick(410));
  expect(screen.getByText("1,700")).toBeInTheDocument();
  act(() => tick(720));
  expect(screen.getByText("1,800")).toBeInTheDocument();
  expect(commits).toHaveBeenCalledTimes(1);
  unmount();
  vi.useRealTimers();
});

test("enabling reduced motion during the roll settles immediately and cancels later frames", () => {
  vi.useFakeTimers();
  let tick, changed;
  const media = {
    matches: false,
    addEventListener: vi.fn((_, callback) => {
      changed = callback;
    }),
    removeEventListener: vi.fn(),
  };
  vi.spyOn(window, "matchMedia").mockReturnValue(media);
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    tick = callback;
    return 42;
  });
  const cancel = vi.spyOn(window, "cancelAnimationFrame");
  const { unmount } = render(
    <ScoreRoll points={800} previousTotal={1000} total={1800} />,
  );
  act(() => vi.advanceTimersByTime(950));
  act(() => {
    media.matches = true;
    changed();
  });
  expect(screen.getByText("1,800")).toBeInTheDocument();
  expect(cancel).toHaveBeenCalledWith(42);
  act(() => tick(0));
  expect(screen.getByText("1,800")).toBeInTheDocument();
  unmount();
  expect(media.removeEventListener).toHaveBeenCalledWith("change", changed);
  vi.useRealTimers();
});
