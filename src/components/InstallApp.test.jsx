import { test, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
const pwa = vi.hoisted(() => ({
  state: {
    installed: false,
    dismissed: false,
    update: false,
    updating: false,
    message: "",
  },
  install: vi.fn(),
  dismiss: vi.fn(),
  update: vi.fn(),
}));
vi.mock("../lib/pwa.js", () => ({
  subscribePWA: () => () => {},
  getPWASnapshot: () => pwa.state,
  requestInstall: pwa.install,
  dismissInstall: pwa.dismiss,
  applyUpdate: pwa.update,
  installInstructions: () => "使用 Safari 分享，再加入主畫面。",
}));
import InstallApp from "./InstallApp.jsx";
beforeEach(() => {
  pwa.state = {
    installed: false,
    dismissed: false,
    update: false,
    updating: false,
    message: "",
  };
  pwa.install.mockReset().mockResolvedValue("manual");
  pwa.dismiss.mockReset();
  pwa.update.mockReset();
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
test("installation instructions appear only after a click and can be dismissed persistently", async () => {
  const user = userEvent.setup();
  render(<InstallApp />);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "安裝 App" }));
  expect(screen.getByRole("dialog")).toBeVisible();
  expect(screen.getByText("使用 Safari 分享，再加入主畫面。")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "暫時不用" }));
  expect(pwa.dismiss).toHaveBeenCalledOnce();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
test("installed users and active games have no install or update controls", () => {
  const { rerender } = render(<InstallApp allowed={false} />);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  pwa.state = { ...pwa.state, installed: true };
  rerender(<InstallApp />);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
test("an available update is an explicit action, never an automatic reload", async () => {
  pwa.state = { ...pwa.state, update: true };
  const user = userEvent.setup();
  render(<InstallApp />);
  expect(pwa.update).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "更新 App" }));
  expect(pwa.update).toHaveBeenCalledOnce();
});
