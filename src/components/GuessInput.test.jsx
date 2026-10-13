import { describe, test, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GuessInput from "./GuessInput.jsx";
const songs = [
  { id: 1, title: "七里香", artist: "周杰倫" },
  { id: 2, title: "稻香", artist: "周杰倫" },
  { id: 3, title: "JUMP", artist: "BLACKPINK" },
];
describe("React autocomplete", () => {
  test("long artist results page without scrolling and paging never submits", async () => {
    const user = userEvent.setup(), guess = vi.fn();
    const tracks = Array.from({length: 6}, (_,i)=>({id:i+10,title:`Song ${i}`,artist:"Singer"}));
    render(<GuessInput songs={tracks} onGuess={guess} />);
    await user.type(screen.getByRole("combobox"), "Singer");
    expect(screen.getAllByRole("option")).toHaveLength(2);
    await user.click(screen.getByRole("button",{name:"下一頁歌曲建議"}));
    expect(screen.getByRole("option",{name:"Song 2 Singer"})).toBeVisible();
    expect(guess).not.toHaveBeenCalled();
    await user.click(screen.getByRole("option",{name:"Song 2 Singer"}));
    await user.click(screen.getByRole("button",{name:"送出答案"}));
    expect(guess).toHaveBeenCalledWith({text:"Song 2",song:tracks[2]});
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
  test("editing a selected suggestion clears the selected identity; arbitrary full text is allowed", async () => {
    const user = userEvent.setup(),
      guess = vi.fn();
    render(<GuessInput songs={songs} onGuess={guess} />);
    const input = screen.getByRole("combobox");
    await user.type(input, "blackpink");
    await user.click(screen.getByRole("option", { name: "JUMP BLACKPINK" }));
    await user.clear(input);
    await user.type(input, "七里香");
    await user.click(screen.getByRole("button", { name: "送出答案" }));
    expect(guess).toHaveBeenCalledWith({ text: "七里香", song: null });
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
    await user.click(input);
    await user.keyboard("{Escape}");
    expect(input).toHaveAttribute("aria-expanded", "false");
    await user.click(screen.getByRole("button", { name: "送出答案" }));
    expect(guess).toHaveBeenCalledOnce();
  });
});
