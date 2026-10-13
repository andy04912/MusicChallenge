export async function request(path, options = {}) {
  const response = await fetch(path, {
    cache: "no-store",
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const result = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(result.error || "操作失敗，請稍後重試。"), {
      status: response.status,
    });
  return result;
}
export function appleURL(song) {
  try {
    const url = new URL(song.url);
    if (!["music.apple.com", "itunes.apple.com"].includes(url.hostname))
      return "https://music.apple.com/tw/";
    url.hostname = "music.apple.com";
    url.protocol = "https:";
    url.searchParams.set("app", "music");
    return url.href;
  } catch {
    return "https://music.apple.com/tw/";
  }
}
export const regionLabels = {
  tw: "華語",
  kr: "K-POP",
  other: "其他／待分類",
};
export const categoryLabels = {
  girl: "女聲／女團",
  boy: "男聲／男團",
  other: "男女合唱",
};
export const statusLabels = {
  draft: "草稿",
  published: "已開放",
  archived: "已下架",
};
