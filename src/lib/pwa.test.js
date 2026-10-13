import { test, expect, vi, beforeEach } from "vitest";
let events, serviceEvents, waiting, registration, module;
beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  events = {};
  serviceEvents = {};
  vi.spyOn(window, "addEventListener").mockImplementation((name, fn) => {
    events[name] = fn;
  });
  vi.spyOn(window, "matchMedia").mockReturnValue({
    matches: false,
    addEventListener() {},
  });
  waiting = { postMessage: vi.fn() };
  registration = { waiting, addEventListener: vi.fn() };
  Object.defineProperty(window, "isSecureContext", {
    value: true,
    configurable: true,
  });
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      controller: {},
      register: vi.fn(async () => registration),
      addEventListener: (name, fn) => {
        serviceEvents[name] = fn;
      },
    },
  });
  module = await import("./pwa.js");
});
test("install is only prompted after a click and respects accepted installation and dismissal persistence", async () => {
  module.initializePWA({ register: false });
  const event = {
    preventDefault: vi.fn(),
    prompt: vi.fn(async () => {}),
    userChoice: Promise.resolve({ outcome: "accepted" }),
  };
  events.beforeinstallprompt(event);
  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(event.prompt).not.toHaveBeenCalled();
  expect(await module.requestInstall()).toBe("accepted");
  expect(event.prompt).toHaveBeenCalledOnce();
  expect(module.getPWASnapshot().installed).toBe(true);
  module.dismissInstall();
  expect(localStorage.getItem("music-challenge-install-dismissed")).toBe("1");
});
test("unsupported native prompts use manual instructions and standalone mode hides installation", async () => {
  vi.spyOn(window, "matchMedia").mockReturnValue({
    matches: true,
    addEventListener() {},
  });
  module.initializePWA({ register: false });
  expect(module.getPWASnapshot().installed).toBe(true);
  expect(await module.requestInstall()).toBe("manual");
  expect(
    module.installInstructions({ userAgent: "iPhone", platform: "iPhone" }),
  ).toContain("Safari");
  expect(
    module.installInstructions({ userAgent: "Chrome", platform: "Linux" }),
  ).toContain("瀏覽器選單");
});
test("updates require an idle explicit request and reload only once after controller change", async () => {
  const reload = vi.fn();
  module.initializePWA({ reload });
  await Promise.resolve();
  expect(module.getPWASnapshot().update).toBe(true);
  expect(waiting.postMessage).not.toHaveBeenCalled();
  module.setPWAActivity(true);
  expect(module.applyUpdate()).toBe(false);
  const source = { postMessage: vi.fn() };
  serviceEvents.message({
    data: { type: "PWA_UPDATE_QUERY", requestId: "check" },
    source,
  });
  expect(source.postMessage).toHaveBeenCalledWith({
    type: "PWA_CLIENT_STATUS",
    requestId: "check",
    active: true,
  });
  module.setPWAActivity(false);
  expect(module.applyUpdate()).toBe(true);
  expect(waiting.postMessage).toHaveBeenCalledWith({ type: "ACTIVATE_UPDATE" });
  serviceEvents.controllerchange();
  serviceEvents.controllerchange();
  expect(reload).toHaveBeenCalledOnce();
});
test("another active tab blocks update without a reload", async () => {
  const reload = vi.fn();
  module.initializePWA({ reload });
  await Promise.resolve();
  module.applyUpdate();
  serviceEvents.message({ data: { type: "PWA_UPDATE_BLOCKED" } });
  serviceEvents.controllerchange();
  expect(reload).not.toHaveBeenCalled();
  expect(module.getPWASnapshot().updating).toBe(false);
  expect(module.getPWASnapshot().message).toContain("其他分頁");
});
