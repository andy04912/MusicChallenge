import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRightIcon,
  CaretLeftIcon,
  CaretRightIcon,
} from "@phosphor-icons/react";
import { normalize, searchSongs } from "../lib/game-logic.js";

export default function GuessInput({
  songs,
  onGuess,
  disabled = false,
  disabledPlaceholder = "先播放，再猜歌",
}) {
  const [text, setText] = useState(""),
    [selected, setSelected] = useState(null),
    [open, setOpen] = useState(false),
    [active, setActive] = useState(-1),
    [page, setPage] = useState(0);
  const composing = useRef(false),
    input = useRef(null),
    pointer = useRef(null),
    restoringFocus = useRef(false),
    handledClick = useRef(null);
  const suggestions = useMemo(() => searchSongs(songs, text), [songs, text]);
  const pageSize = 4;
  const expanded = !disabled && open && suggestions.length > 0;
  const pages = Math.ceil(suggestions.length / pageSize);
  useEffect(() => {
    if (
      !disabled &&
      !window.matchMedia("(pointer: coarse)").matches &&
      window.innerWidth > 767
    )
      input.current?.focus({ preventScroll: true });
  }, [disabled]);
  function focusInput() {
    restoringFocus.current = true;
    input.current?.focus({ preventScroll: true });
    restoringFocus.current = false;
  }
  function choose(song) {
    if (disabled) return;
    setText(song.title);
    setSelected(song);
    setOpen(false);
    setActive(-1);
    focusInput();
  }
  // Activate on pointer release: mobile browsers may blur before click, or omit
  // the compatibility click after preventDefault. Keep the keyboard/layout stable.
  function suggestionAction(action) {
    return {
      onPointerDown(event) {
        if (event.button !== 0 || event.isPrimary === false) return;
        pointer.current = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
        };
        handledClick.current = null;
        event.preventDefault();
      },
      onPointerUp(event) {
        const press = pointer.current;
        if (!press || press.id !== event.pointerId) return;
        pointer.current = null;
        handledClick.current = {
          target: event.currentTarget,
          until: Date.now() + 700,
        };
        event.preventDefault();
        if (
          !disabled &&
          Math.hypot(event.clientX - press.x, event.clientY - press.y) <= 12
        ) {
          action();
          focusInput();
        }
      },
      onPointerCancel() {
        pointer.current = null;
        if (document.activeElement !== input.current) setOpen(false);
      },
      onClick(event) {
        const handled = handledClick.current;
        handledClick.current = null;
        if (
          handled?.target === event.currentTarget &&
          Date.now() < handled.until
        )
          return;
        if (!disabled) action();
      },
    };
  }
  function change(value) {
    setText(value);
    setSelected(null);
    setActive(-1);
    setPage(0);
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
      const index =
        event.key === "ArrowDown"
          ? (active + 1) % suggestions.length
          : active <= 0
            ? suggestions.length - 1
            : active - 1;
      setOpen(true);
      setActive(index);
      setPage(Math.floor(index / pageSize));
    } else if (event.key === "Enter" && expanded && active >= 0) {
      event.preventDefault();
      choose(suggestions[active]);
    }
  }
  return (
    <form
      id="guess-form"
      className="guess-form compact-guess"
      autoComplete="off"
      onSubmit={(event) => {
        event.preventDefault();
        if (
          !disabled &&
          !composing.current &&
          selected &&
          songs.includes(selected)
        ) {
          setOpen(false);
          onGuess({ text, song: selected });
        }
      }}
    >
      <label htmlFor="guess-input" className="sr-only">
        你的答案
      </label>
      <div className="answer-entry">
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
          placeholder={disabled ? disabledPlaceholder : "輸入歌名或歌手…"}
          maxLength={200}
          spellCheck={false}
          autoComplete="off"
          enterKeyHint="send"
          onKeyDown={keyDown}
          onFocus={() => {
            if (!selected && !restoringFocus.current) setOpen(true);
          }}
          onBlur={(event) => {
            if (pointer.current) return;
            if (!event.relatedTarget?.closest?.(".compact-guess")) {
              setOpen(false);
              setActive(-1);
            }
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
        <button
          type="submit"
          className="answer-submit"
          id="submit-guess"
          aria-label="送出答案"
          disabled={disabled || !selected || !songs.includes(selected)}
        >
          <ArrowRightIcon aria-hidden="true" />
          <span>送出</span>
        </button>
      </div>
      <div className="suggestions-panel" hidden={!expanded}>
        <div id="guess-suggestions" role="listbox" aria-label="歌曲建議">
          {suggestions
            .slice(page * pageSize, (page + 1) * pageSize)
            .map((song, local) => {
              const index = page * pageSize + local;
              return (
                <button
                  type="button"
                  tabIndex={-1}
                  key={song.id}
                  id={`suggestion-${index}`}
                  className="song-suggestion"
                  role="option"
                  aria-label={`${song.title} ${song.artist}`}
                  aria-selected={index === active}
                  {...suggestionAction(() => choose(song))}
                >
                  <strong>{song.title}</strong>
                  <span>{song.artist}</span>
                </button>
              );
            })}
        </div>
        {pages > 1 && (
          <div className="suggestion-pages">
            <button
              type="button"
              aria-label="上一頁歌曲建議"
              disabled={page === 0}
              {...suggestionAction(() => {
                setPage(page - 1);
                setActive(-1);
              })}
            >
              <CaretLeftIcon />
            </button>
            <span>
              {page + 1} / {pages} · 繼續輸入可縮小範圍
            </span>
            <button
              type="button"
              aria-label="下一頁歌曲建議"
              disabled={page >= pages - 1}
              {...suggestionAction(() => {
                setPage(page + 1);
                setActive(-1);
              })}
            >
              <CaretRightIcon />
            </button>
          </div>
        )}
      </div>
      {!disabled && open && normalize(text) && !suggestions.length && (
        <p className="suggestions-panel guess-search-empty" role="status">
          找不到歌曲，試試部分歌名或歌手名稱。
        </p>
      )}
      <p id="guess-help" className="sr-only">
        搜尋歌名或歌手後，必須從選單選取歌曲才能送出。上下鍵選歌、Enter
        選取，再送出答案。
      </p>
      <p id="guess-status" className="sr-only" role="status">
        {selected
          ? `已選 ${selected.title}，按送出答案確認。`
          : expanded
            ? `共 ${suggestions.length} 首建議，第 ${page + 1} 頁。`
            : ""}
      </p>
    </form>
  );
}
