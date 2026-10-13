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

test("Taiwan chart tabs preselect the matching import library and retain draft import", async () => {
  const calls = [];
  vi.stubGlobal("fetch", vi.fn(async (path, options) => {
    calls.push([path, options]);
    if (path.endsWith("/session")) return new Response(JSON.stringify({csrf:"test-csrf"}));
    if (path.includes("charts?type=")) {
      const region = path.endsWith("kpop") ? "kr" : "tw";
      return new Response(JSON.stringify({region,updatedAt:"2026-10-13T00:00:00Z",songs:[{id:42,title:"Chart song",artist:"Artist",rank:7,region,preview:"https://audio-ssl.itunes.apple.com/test.m4a"}]}));
    }
    if (path.endsWith("/import")) return new Response(JSON.stringify({imported:1}));
    return new Response("[]");
  }));
  const user=userEvent.setup(); render(<AdminPage />);
  await screen.findByRole("heading",{name:"歌曲管理"});
  await user.click(screen.getByRole("tab",{name:"搜尋 Apple 曲庫"}));
  expect(screen.queryByRole("button",{name:"韓國熱門"})).not.toBeInTheDocument();
  await user.click(screen.getByRole("button",{name:"台灣熱門・華語"}));
  await waitFor(()=>expect(screen.getByRole("combobox",{name:"匯入曲庫類型"})).toHaveValue("tw"));
  await user.click(screen.getByRole("checkbox",{name:"選擇 Chart song · Artist"}));
  await user.click(screen.getByRole("button",{name:"台灣熱門・K-POP"}));
  await waitFor(()=>expect(screen.getByRole("combobox",{name:"匯入曲庫類型"})).toHaveValue("kr"));
  expect(screen.getByRole("checkbox",{name:"選擇 Chart song · Artist"})).not.toBeChecked();
  await user.click(screen.getByRole("checkbox",{name:"選擇 Chart song · Artist"}));
  await user.click(screen.getByRole("button",{name:"加入草稿"}));
  await waitFor(()=>expect(calls.some(([path])=>path.endsWith('/import'))).toBe(true));
  const imported=JSON.parse(calls.find(([path])=>path.endsWith('/import'))[1].body);
  expect(imported).toEqual({ids:[42],category:"other",region:"kr"});
  vi.unstubAllGlobals();
});
