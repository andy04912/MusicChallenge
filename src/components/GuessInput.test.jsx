import { describe, test, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GuessInput from "./GuessInput.jsx";
const songs = [
  { id: 1, title: "七里香", artist: "周杰倫" },
  { id: 2, title: "稻香", artist: "周杰倫" },
  { id: 3, title: "JUMP", artist: "BLACKPINK" },
];
function touch(element, type, x = 20, y = 20) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: x,
    clientY: y,
  });
  Object.defineProperties(event, {
    pointerId: { value: 7 },
    pointerType: { value: "touch" },
    isPrimary: { value: true },
  });
  fireEvent(element, event);
}
describe("React autocomplete", () => {
  test("touching a disabled paging button cannot leave the first or last page", async () => {
    const user = userEvent.setup(),
      guess = vi.fn();
    const tracks = Array.from({ length: 5 }, (_, i) => ({
      id: i + 10,
      title: `Song ${i}`,
      artist: "Singer",
    }));
    render(<GuessInput songs={tracks} onGuess={guess} />);
    await user.type(screen.getByRole("combobox"), "Singer");
    const previous = screen.getByRole("button", { name: "上一頁歌曲建議" });
    touch(previous, "pointerdown");
    touch(previous, "pointerup");
    expect(screen.getByText("1 / 2 · 繼續輸入可縮小範圍")).toBeVisible();
    const next = screen.getByRole("button", { name: "下一頁歌曲建議" });
    touch(next, "pointerdown");
    touch(next, "pointerup");
    expect(next).toBeDisabled();
    for (let i = 0; i < 4; i++) {
      touch(next, "pointerdown");
      touch(next, "pointerup");
      fireEvent.click(next, { detail: 1 });
    }
    expect(screen.getByText("2 / 2 · 繼續輸入可縮小範圍")).toBeVisible();
    expect(screen.getByRole("option", { name: "Song 4 Singer" })).toBeVisible();
    expect(guess).not.toHaveBeenCalled();
  });
  test("a shrinking song pool clamps the page immediately and keeps selection usable", async () => {
    const user = userEvent.setup(),
      guess = vi.fn();
    const tracks = Array.from({ length: 10 }, (_, i) => ({
      id: i + 10,
      title: `Song ${i}`,
      artist: "Singer",
    }));
    const view = render(<GuessInput songs={tracks} onGuess={guess} />);
    await user.type(screen.getByRole("combobox"), "Singer");
    const next = screen.getByRole("button", { name: "下一頁歌曲建議" });
    await user.click(next);
    await user.click(next);
    view.rerender(<GuessInput songs={tracks.slice(0, 5)} onGuess={guess} />);
    expect(screen.getByText("2 / 2 · 繼續輸入可縮小範圍")).toBeVisible();
    await user.click(screen.getByRole("option", { name: "Song 4 Singer" }));
    await user.click(screen.getByRole("button", { name: "送出答案" }));
    expect(guess).toHaveBeenCalledExactlyOnceWith({
      text: "Song 4",
      song: tracks[4],
    });
  });
  function mobile() {
    vi.spyOn(window, "matchMedia").mockImplementation(() => ({
      matches: true,
      addEventListener() {},
      removeEventListener() {},
    }));
  }
  test("mobile results stay paginated when the keyboard reduces available height", async () => {
    mobile();
    const viewport = Object.assign(new EventTarget(), { height: 500 });
    vi.stubGlobal("visualViewport", viewport);
    try {
      const user = userEvent.setup();
      const tracks = Array.from({ length: 8 }, (_, i) => ({
        id: i + 10,
        title: `Song ${i}`,
        artist: "Singer",
      }));
      render(<GuessInput songs={tracks} onGuess={vi.fn()} />);
      await user.type(screen.getByRole("combobox"), "Singer");
      expect(screen.getAllByRole("option")).toHaveLength(4);
      await user.click(screen.getByRole("button", { name: "下一頁歌曲建議" }));
      act(() => {
        viewport.height = 300;
        viewport.dispatchEvent(new Event("resize"));
      });
      expect(screen.getAllByRole("option")).toHaveLength(2);
      expect(
        screen.getByRole("option", { name: "Song 0 Singer" }),
      ).toBeVisible();
      await user.click(screen.getByRole("button", { name: "下一頁歌曲建議" }));
      expect(
        screen.getByRole("option", { name: "Song 2 Singer" }),
      ).toBeVisible();
    } finally {
      vi.unstubAllGlobals();
    }
  });
  test("mobile touch selection closes search and keyboard without submitting", async () => {
    mobile();
    const user = userEvent.setup(),
      guess = vi.fn();
    render(<GuessInput songs={songs} onGuess={guess} />);
    const input = screen.getByRole("combobox"),
      form = input.closest("form");
    await user.type(input, "周");
    expect(form).toHaveClass("is-searching");
    const option = screen.getByRole("option", { name: "七里香 周杰倫" });
    touch(option, "pointerdown");
    touch(option, "pointerup");
    fireEvent.click(option, { detail: 1 });
    expect(form).not.toHaveClass("is-searching");
    expect(input).not.toHaveFocus();
    expect(input).toHaveValue("七里香");
    expect(guess).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "送出答案" }));
    expect(guess).toHaveBeenCalledExactlyOnceWith({
      text: "七里香",
      song: songs[0],
    });
  });
  test("mobile return preserves search text and still requires explicit selection", async () => {
    mobile();
    const user = userEvent.setup(),
      guess = vi.fn();
    render(<GuessInput songs={songs} onGuess={guess} />);
    const input = screen.getByRole("combobox");
    await user.type(input, "七里香");
    await user.click(screen.getByRole("button", { name: "返回遊戲" }));
    expect(input.closest("form")).not.toHaveClass("is-searching");
    expect(input).toHaveValue("七里香");
    expect(screen.getByRole("button", { name: "送出答案" })).toBeDisabled();
    await user.click(input);
    expect(input.closest("form")).toHaveClass("is-searching");
    expect(screen.getByRole("option", { name: "七里香 周杰倫" })).toBeVisible();
    await user.keyboard("{Escape}");
    expect(input.closest("form")).not.toHaveClass("is-searching");
    expect(guess).not.toHaveBeenCalled();
  });
  test.each(["周", "七里"])(
    "touch selection survives blur and needs no synthetic click: %s",
    async (query) => {
      const user = userEvent.setup(),
        guess = vi.fn();
      render(<GuessInput songs={songs} onGuess={guess} />);
      const input = screen.getByRole("combobox");
      await user.type(input, query);
      const option = screen.getByRole("option", { name: "七里香 周杰倫" });
      touch(option, "pointerdown");
      act(() => input.blur());
      expect(option).toBeVisible();
      touch(option, "pointerup");
      expect(input).toHaveValue("七里香");
      expect(input).toHaveFocus();
      expect(input).toHaveAttribute("aria-expanded", "false");
      expect(guess).not.toHaveBeenCalled();
      await user.click(screen.getByRole("button", { name: "送出答案" }));
      expect(guess).toHaveBeenCalledExactlyOnceWith({
        text: "七里香",
        song: songs[0],
      });
    },
  );
  test("touch paging survives blur and the compatibility click does not advance twice", async () => {
    const user = userEvent.setup(),
      guess = vi.fn();
    const tracks = Array.from({ length: 10 }, (_, i) => ({
      id: i + 10,
      title: `Song ${i}`,
      artist: "Singer",
    }));
    render(<GuessInput songs={tracks} onGuess={guess} />);
    const input = screen.getByRole("combobox");
    await user.type(input, "Sing");
    const next = screen.getByRole("button", { name: "下一頁歌曲建議" });
    touch(next, "pointerdown");
    act(() => input.blur());
    touch(next, "pointerup");
    fireEvent.click(next, { detail: 1 });
    expect(screen.getByRole("option", { name: "Song 4 Singer" })).toBeVisible();
    expect(
      screen.queryByRole("option", { name: "Song 8 Singer" }),
    ).not.toBeInTheDocument();
    expect(guess).not.toHaveBeenCalled();
  });
  test("cancelled or dragged touch does not choose an answer", async () => {
    const user = userEvent.setup();
    render(<GuessInput songs={songs} onGuess={vi.fn()} />);
    const input = screen.getByRole("combobox");
    await user.type(input, "周");
    const option = screen.getByRole("option", { name: "七里香 周杰倫" });
    touch(option, "pointerdown");
    touch(option, "pointercancel");
    touch(option, "pointerup");
    expect(input).toHaveValue("周");
    touch(option, "pointerdown");
    touch(option, "pointerup", 20, 80);
    fireEvent.click(option, { detail: 1 });
    expect(input).toHaveValue("周");
  });
  test("long artist results page without scrolling and paging never submits", async () => {
    const user = userEvent.setup(),
      guess = vi.fn();
    const tracks = Array.from({ length: 6 }, (_, i) => ({
      id: i + 10,
      title: `Song ${i}`,
      artist: "Singer",
    }));
    render(<GuessInput songs={tracks} onGuess={guess} />);
    await user.type(screen.getByRole("combobox"), "Singer");
    expect(screen.getAllByRole("option")).toHaveLength(4);
    await user.click(screen.getByRole("button", { name: "下一頁歌曲建議" }));
    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(screen.getByRole("option", { name: "Song 4 Singer" })).toBeVisible();
    expect(guess).not.toHaveBeenCalled();
    await user.click(screen.getByRole("option", { name: "Song 4 Singer" }));
    await user.click(screen.getByRole("button", { name: "送出答案" }));
    expect(guess).toHaveBeenCalledWith({ text: "Song 4", song: tracks[4] });
  });
  test("artist search and keyboard selection require a separate submit", async () => {
    const user = userEvent.setup(),
      guess = vi.fn();
    render(<GuessInput songs={songs} onGuess={guess} />);
    const input = screen.getByRole("combobox");
    await user.type(input, "周杰倫");
    expect(screen.getAllByRole("option")).toHaveLength(2);
    await user.keyboard("{ArrowDown}{Enter}");
    expect(guess).not.toHaveBeenCalled();
    expect(input).toHaveAttribute("aria-expanded", "false");
    await user.click(screen.getByRole("button", { name: "送出答案" }));
    expect(guess).toHaveBeenCalledWith(
      expect.objectContaining({
        song: expect.objectContaining({ artist: "周杰倫" }),
      }),
    );
  });
  test("editing a selected suggestion requires selecting the new title", async () => {
    const user = userEvent.setup(),
      guess = vi.fn();
    render(<GuessInput songs={songs} onGuess={guess} />);
    const input = screen.getByRole("combobox");
    await user.type(input, "blackpink");
    await user.click(screen.getByRole("option", { name: "JUMP BLACKPINK" }));
    await user.clear(input);
    await user.type(input, "七里香");
    expect(screen.getByRole("button", { name: "送出答案" })).toBeDisabled();
    await user.click(screen.getByRole("option", { name: "七里香 周杰倫" }));
    await user.click(screen.getByRole("button", { name: "送出答案" }));
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(guess).toHaveBeenCalledWith({ text: "七里香", song: songs[0] });
  });
  test("IME confirmation never submits mid-composition, and Escape closes suggestions", async () => {
    const user = userEvent.setup(),
      guess = vi.fn();
    render(<GuessInput songs={songs} onGuess={guess} />);
    const input = screen.getByRole("combobox");
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "七里香" } });
    fireEvent.submit(input.closest("form"));
    expect(guess).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input, { data: "七里香" });
    expect(input).toHaveAttribute("aria-expanded", "true");
    await user.click(screen.getByRole("option", { name: "七里香 周杰倫" }));
    await user.click(input);
    await user.keyboard("{Escape}");
    expect(input).toHaveAttribute("aria-expanded", "false");
    await user.click(screen.getByRole("button", { name: "送出答案" }));
    expect(guess).toHaveBeenCalledOnce();
    expect(guess).toHaveBeenCalledWith({ text: "七里香", song: songs[0] });
  });
  test("a pasted full title still requires an explicit selection", async () => {
    const guess = vi.fn(),
      user = userEvent.setup();
    render(<GuessInput songs={songs} onGuess={guess} />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "ｊｕｍｐ" } });
    expect(input).toHaveValue("ｊｕｍｐ");
    expect(
      screen.getByRole("option", { name: "JUMP BLACKPINK" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "送出答案" })).toBeDisabled();
    fireEvent.submit(input.closest("form"));
    expect(guess).not.toHaveBeenCalled();
    await user.click(screen.getByRole("option", { name: "JUMP BLACKPINK" }));
    fireEvent.submit(input.closest("form"));
    expect(guess).toHaveBeenCalledWith({ text: "JUMP", song: songs[2] });
  });
  test("same title by different singers stays selectable; unknown free text cannot submit", async () => {
    const user = userEvent.setup(),
      guess = vi.fn();
    const tracks = [...songs, { id: 4, title: "七里香", artist: "另一歌手" }];
    render(<GuessInput songs={tracks} onGuess={guess} />);
    const input = screen.getByRole("combobox");
    await user.type(input, "七里香");
    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("option")).toHaveLength(2);
    await user.click(screen.getByRole("option", { name: "七里香 周杰倫" }));
    await user.click(screen.getByRole("button", { name: "送出答案" }));
    expect(guess).toHaveBeenLastCalledWith({ text: "七里香", song: songs[0] });
    await user.clear(input);
    await user.type(input, "不在建議裡的歌");
    expect(
      screen.getByText("找不到歌曲，試試部分歌名或歌手名稱。"),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "送出答案" }));
    expect(screen.getByRole("button", { name: "送出答案" })).toBeDisabled();
    fireEvent.submit(input.closest("form"));
    expect(guess).toHaveBeenCalledTimes(1);
  });
});
