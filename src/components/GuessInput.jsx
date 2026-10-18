import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRightIcon,
  ArrowLeftIcon,
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
    [searching, setSearching] = useState(false),
    [pageSize, setPageSize] = useState(4),
    [page, setPage] = useState(0);
  const composing = useRef(false),
    input = useRef(null),
    pointer = useRef(null),
    restoringFocus = useRef(false),
    handledClick = useRef(null);
  const suggestions = useMemo(() => searchSongs(songs, text), [songs, text]);
  const expanded = !disabled && open && suggestions.length > 0;
  const pages = Math.ceil(suggestions.length / pageSize);
  const lastPage = Math.max(0, pages - 1);
  const clampPage = (value) => Math.max(0, Math.min(value, lastPage));
  const currentPage = clampPage(page);
  const activeIndex =
    active >= 0 &&
    active < suggestions.length &&
    Math.floor(active / pageSize) === currentPage
      ? active
      : -1;
  function movePage(delta) {
    setPage((previous) => clampPage(clampPage(previous) + delta));
    setActive(-1);
  }
  useEffect(() => {
    if (!searching) {
      setPageSize(4);
      return;
    }
    const viewport = window.visualViewport;
    function resize() {
      // Reserve space for the back button, input, paging and safe-area padding.
      const style = getComputedStyle(input.current.closest("form"));
      const padding =
        (parseFloat(style.paddingTop) || 8) +
        (parseFloat(style.paddingBottom) || 8);
      const rows = Math.max(
        1,
        Math.min(
          4,
          Math.floor(
            ((viewport?.height || window.innerHeight) - 168 - padding) / 48,
          ),
        ),
      );
      setPageSize(rows);
      setPage(0);
      setActive(-1);
    }
    resize();
    viewport?.addEventListener("resize", resize);
    window.addEventListener("resize", resize);
    return () => {
      viewport?.removeEventListener("resize", resize);
      window.removeEventListener("resize", resize);
    };
  }, [searching]);
  useEffect(() => {
    if (disabled && searching) {
      setSearching(false);
      input.current?.blur();
    }
  }, [disabled, searching]);
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
    if (disabled || !song || !songs.includes(song)) return;
    setText(song.title);
    setSelected(song);
    setOpen(false);
    setActive(-1);
    if (searching) closeSearch();
    else focusInput();
  }
  function closeSearch() {
    setSearching(false);
    setOpen(false);
    setActive(-1);
    input.current?.blur();
  }
  // Activate on pointer release: mobile browsers may blur before click, or omit
  // the compatibility click after preventDefault. Keep the keyboard/layout stable.
  function suggestionAction(action, keepFocus = true) {
    return {
      onPointerDown(event) {
        if (disabled || event.currentTarget.disabled) {
          event.preventDefault();
          return;
        }
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
        if (disabled || event.currentTarget.disabled) {
          event.preventDefault();
          pointer.current = null;
          return;
        }
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
          if (keepFocus) focusInput();
        }
      },
      onPointerCancel() {
        pointer.current = null;
        if (document.activeElement !== input.current) setOpen(false);
      },
      onClick(event) {
        if (disabled || event.currentTarget.disabled) return;
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
      if (searching) closeSearch();
    } else if (["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      if (!suggestions.length) return;
      const index =
        event.key === "ArrowDown"
          ? (activeIndex + 1) % suggestions.length
          : activeIndex <= 0
            ? suggestions.length - 1
            : activeIndex - 1;
      setOpen(true);
      setActive(index);
      setPage(Math.floor(index / pageSize));
    } else if (event.key === "Enter" && expanded && activeIndex >= 0) {
      event.preventDefault();
      choose(suggestions[activeIndex]);
    }
  }
  return (
    <form
      id="guess-form"
      className={`guess-form compact-guess${searching ? " is-searching" : ""}`}
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
      <div className="guess-search-heading">
        <button type="button" onClick={closeSearch} aria-label="返回遊戲">
          <ArrowLeftIcon aria-hidden="true" />
          <span>返回</span>
        </button>
        <strong>搜尋答案</strong>
        <span>選取後送出</span>
      </div>
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
            expanded && activeIndex >= 0
              ? `suggestion-${activeIndex}`
              : undefined
          }
          aria-describedby="guess-help guess-status"
          placeholder={disabled ? disabledPlaceholder : "輸入歌名或歌手…"}
          maxLength={200}
          spellCheck={false}
          autoComplete="off"
          enterKeyHint="send"
          onKeyDown={keyDown}
          onFocus={() => {
            if (
              window.matchMedia(
                "(max-width: 767px), (max-width: 1023px) and (max-height: 500px)",
              ).matches
            )
              setSearching(true);
            if (!selected && !restoringFocus.current) setOpen(true);
          }}
          onBlur={(event) => {
            if (pointer.current) return;
            if (!event.relatedTarget?.closest?.(".compact-guess")) {
              setOpen(false);
              setActive(-1);
              setSearching(false);
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
            .slice(currentPage * pageSize, (currentPage + 1) * pageSize)
            .map((song, local) => {
              const index = currentPage * pageSize + local;
              return (
                <button
                  type="button"
                  tabIndex={-1}
                  key={song.id}
                  id={`suggestion-${index}`}
                  className="song-suggestion"
                  role="option"
                  aria-label={`${song.title} ${song.artist}`}
                  aria-selected={index === activeIndex}
                  {...suggestionAction(() => choose(song), false)}
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
              disabled={currentPage === 0}
              {...suggestionAction(() => movePage(-1))}
            >
              <CaretLeftIcon />
            </button>
            <span>
              {currentPage + 1} / {pages} · 繼續輸入可縮小範圍
            </span>
            <button
              type="button"
              aria-label="下一頁歌曲建議"
              disabled={currentPage === lastPage}
              {...suggestionAction(() => movePage(1))}
            >
              <CaretRightIcon />
            </button>
          </div>
        )}
      </div>
      {searching && !normalize(text) && (
        <p className="guess-search-prompt">
          輸入部分歌名或歌手，從清單選擇答案。
        </p>
      )}
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
            ? `共 ${suggestions.length} 首建議，第 ${currentPage + 1} 頁。`
            : ""}
      </p>
    </form>
  );
}
