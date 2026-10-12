import { test, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AdminPage from "./AdminPage.jsx";
test("admin session, batch region update, release and logout retain their API contract", async () => {
  let song = {
    id: 1,
    title: "七里香",
    artist: "周杰倫",
    album: "七里香",
    year: "2004",
    status: "draft",
    region: "other",
    category: "other",
    artwork: "",
    preview: "https://audio-ssl.itunes.apple.com/test.m4a",
    url: "https://music.apple.com/tw/song/1",
  };
  const calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path, options) => {
      calls.push([path, options]);
      if (path.endsWith("/session"))
        return new Response(JSON.stringify({ csrf: "test-csrf" }));
      if (options.method === "PATCH") {
        Object.assign(song, JSON.parse(options.body));
        return new Response(JSON.stringify({ updated: 1 }));
      }
      if (path.endsWith("/logout")) return new Response("{}");
      return new Response(JSON.stringify([song]));
    }),
  );
  const user = userEvent.setup();
  render(<AdminPage />);
  await screen.findByRole("heading", { name: "歌曲管理" });
  await user.click(
    screen.getByRole("checkbox", { name: "選擇 七里香 · 周杰倫" }),
  );
  await user.selectOptions(
    screen.getByRole("combobox", { name: "改曲庫類型" }),
    "tw",
  );
  await user.click(screen.getByRole("button", { name: "套用曲庫" }));
  await screen.findByText("已更新 1 首歌曲的曲庫類型。");
  expect(song.region).toBe("tw");
  const mutation = calls.find(([, o]) => o.method === "PATCH");
  expect(mutation[1].headers["X-CSRF-Token"]).toBe("test-csrf");
  await user.click(
    screen.getByRole("checkbox", { name: "選擇 七里香 · 周杰倫" }),
  );
  await user.click(screen.getByRole("button", { name: "開放歌曲" }));
  await waitFor(() => expect(song.status).toBe("published"));
  await user.click(screen.getByRole("button", { name: "登出" }));
  await screen.findByLabelText("管理員密碼");
  expect(screen.queryByText("七里香")).not.toBeInTheDocument();
  vi.unstubAllGlobals();
});
