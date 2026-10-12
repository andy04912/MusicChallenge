import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRightIcon } from "@phosphor-icons/react";
import { normalize, searchSongs } from "../lib/game-logic.js";

export default function GuessInput({ songs, onGuess, disabled = false }) {
  const [text, setText] = useState(""),
    [selected, setSelected] = useState(null),
    [open, setOpen] = useState(false),
    [active, setActive] = useState(-1);
  const composing = useRef(false),
    input = useRef(null),
    list = useRef(null);
  const suggestions = useMemo(() => searchSongs(songs, text), [songs, text]);
  const expanded = open && suggestions.length > 0;
  useEffect(() => {
    if (expanded && active >= 0)
      list.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active, expanded]);
  function choose(song) {
    setText(song.title);
    setSelected(song);
    setOpen(false);
    setActive(-1);
    input.current.focus();
  }
  function change(value) {
    setText(value);
    setSelected(null);
    setActive(-1);
    setOpen(!composing.current);
  }
  function keyDown(event) {
    if (
      composing.current ||
      event.nativeEvent.isComposing ||
      event.keyCode === 229
    )
      return;
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      setActive(-1);
    } else if (["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      if (!suggestions.length) return;
      setOpen(true);
      setActive((previous) =>
        event.key === "ArrowDown"
          ? (previous + 1) % suggestions.length
          : previous <= 0
            ? suggestions.length - 1
            : previous - 1,
      );
    } else if (event.key === "Enter" && expanded && active >= 0) {
      event.preventDefault();
      choose(suggestions[active]);
    }
  }
  const status = selected
    ? `已選：${selected.title} · ${selected.artist}，按「送出答案」確認。`
    : !text.trim()
      ? ""
      : suggestions.length
        ? `顯示 ${suggestions.length} 首建議${suggestions.length === 8 ? "，可繼續輸入縮小範圍" : ""}。`
        : "目前分類沒有符合的建議；你仍可直接輸入完整歌名作答。";
  return (
    <form
      id="guess-form"
      className="guess-form"
      autoComplete="off"
      onSubmit={(event) => {
        event.preventDefault();
        if (!disabled && !composing.current && normalize(text))
          onGuess({ text, song: selected });
      }}
    >
      <label htmlFor="guess-input" className="field-label">
        你的答案
      </label>
      <div className="autocomplete">
        <input
          ref={input}
          disabled={disabled}
          id="guess-input"
          value={text}
          onChange={(event) => change(event.target.value)}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-controls="guess-suggestions"
          aria-expanded={expanded}
          aria-activedescendant={
            expanded && active >= 0 ? `suggestion-${active}` : undefined
          }
          aria-describedby="guess-help guess-status"
          placeholder={disabled ? "按播放開始" : "輸入歌名或歌手…"}
          maxLength={200}
          spellCheck={false}
          autoComplete="off"
          onKeyDown={keyDown}
          onFocus={() => {
            if (!selected) setOpen(true);
          }}
          onBlur={() => {
            setOpen(false);
            setActive(-1);
          }}
          onCompositionStart={() => {
            composing.current = true;
            setOpen(false);
          }}
          onCompositionEnd={(event) => {
            composing.current = false;
            change(event.currentTarget.value);
          }}
        />
        <div
          ref={list}
          id="guess-suggestions"
          role="listbox"
          aria-label="歌曲建議"
          hidden={!expanded}
        >
          {suggestions.map((song, index) => (
            <div
              key={song.id}
              id={`suggestion-${index}`}
              className="song-suggestion"
              role="option"
              aria-label={`${song.title} ${song.artist}`}
              aria-selected={index === active}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => choose(song)}
            >
              <strong>{song.title}</strong>
              <span>{song.artist}</span>
            </div>
          ))}
        </div>
      </div>
      <p id="guess-help" className="sr-only">
        可直接輸入完整歌名送出，或從建議選歌。↑ ↓ 選擇，Enter 確認。
      </p>
      <p id="guess-status" className="guess-status sr-only" role="status">
        {status}
      </p>
      <button
        type="submit"
        className="primary"
        id="submit-guess"
        disabled={disabled || !normalize(text)}
      >
        送出答案 <ArrowRightIcon aria-hidden="true" />
      </button>
    </form>
  );
}
