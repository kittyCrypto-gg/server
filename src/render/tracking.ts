import type { Page } from "puppeteer-core";
import type { RenderState } from "./types";

export async function installTracking(page: Page): Promise<void> {
  await page.evaluateOnNewDocument(() => {
    const win = window as Window & {
      __RENDER__?: RenderState;
    };

    const state: RenderState = {
      inflight: 0,
      mutationCount: 0,
      lastCheckedMutationCount: 0,
      quietFrameCount: 0
    };

    Object.defineProperty(win, "__RENDER__", {
      value: state,
      writable: false,
      configurable: false,
      enumerable: false
    });

    const mark = (): void => {
      state.mutationCount += 1;
      state.quietFrameCount = 0;
    };

    const begin = (): void => {
      state.inflight += 1;
      state.quietFrameCount = 0;
    };

    const end = (): void => {
      state.inflight = Math.max(0, state.inflight - 1);
    };

    const startObserver = (): void => {
      const root = document.documentElement;

      if (root === null) {
        return;
      }

      const observer = new MutationObserver(() => {
        mark();
      });

      observer.observe(root, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true
      });
    };

    if (document.documentElement !== null) {
      startObserver();
    } else {
      document.addEventListener("readystatechange", startObserver, {
        once: true
      });
    }

    if (typeof window.fetch === "function") {
      const realFetch = window.fetch.bind(window);
      const trackedFetch = Object.assign(
        async (...args: Parameters<typeof window.fetch>): Promise<Response> => {
          begin();

          try {
            return await realFetch(...args);
          } finally {
            end();
          }
        },
        window.fetch
      );

      window.fetch = trackedFetch;
    }

    if (typeof XMLHttpRequest !== "undefined") {
      const realSend = XMLHttpRequest.prototype.send;

      XMLHttpRequest.prototype.send = function (...args) {
        begin();

        this.addEventListener("loadend", () => {
          end();
        }, { once: true });

        return realSend.apply(
          this,
          args as Parameters<XMLHttpRequest["send"]>
        );
      };
    }
  });
}

export async function waitForSettle(page: Page, timeoutMs: number): Promise<void> {
  await page.waitForFunction(
    () => {
      const win = window as Window & {
        __RENDER__?: RenderState;
      };

      const state = win.__RENDER__;

      if (state === undefined) {
        return false;
      }

      if (state.inflight > 0) {
        state.lastCheckedMutationCount = state.mutationCount;
        state.quietFrameCount = 0;
        return false;
      }

      if (state.mutationCount !== state.lastCheckedMutationCount) {
        state.lastCheckedMutationCount = state.mutationCount;
        state.quietFrameCount = 0;
        return false;
      }

      state.quietFrameCount += 1;

      return state.quietFrameCount >= 2;
    },
    {
      polling: "raf",
      timeout: timeoutMs
    }
  );
}
