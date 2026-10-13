import { expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import ShareResultButton from "./ShareResultButton.jsx";
test("a public receipt is created only after explicit share and navigates to its result", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ id: "public-result" }))),
  );
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <Routes>
        <Route
          path="/"
          element={<ShareResultButton sessionId="private-run" />}
        />
        <Route path="/result/:id" element={<h1>公開戰果</h1>} />
      </Routes>
    </MemoryRouter>,
  );
  expect(fetch).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "分享戰果" }));
  await screen.findByRole("heading", { name: "公開戰果" });
  expect(fetch).toHaveBeenCalledWith(
    "/api/results",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ sessionId: "private-run" }),
    }),
  );
});
