import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getNextClockDelayMs,
  resolveShutdownNotificationSupport,
} from "./notifications";

describe("shutdown notification helpers", () => {
  const originalTimezone = process.env.TZ;

  beforeAll(() => {
    process.env.TZ = "UTC";
  });

  afterAll(() => {
    if (originalTimezone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTimezone;
    }
  });

  it("reports support only when the required browser APIs are available", () => {
    expect(
      resolveShutdownNotificationSupport({
        isSecureContext: true,
        hasNotification: true,
        hasServiceWorker: true,
        hasShowNotification: true,
      }),
    ).toMatchObject({ supported: true });

    expect(
      resolveShutdownNotificationSupport({
        isSecureContext: true,
        hasNotification: false,
        hasServiceWorker: true,
        hasShowNotification: true,
      }),
    ).toMatchObject({
      supported: false,
      message: "Notifications are not supported in this browser.",
    });

    expect(
      resolveShutdownNotificationSupport({
        isSecureContext: true,
        hasNotification: true,
        hasServiceWorker: false,
        hasShowNotification: false,
      }),
    ).toMatchObject({ supported: false });
  });

  it("computes the next shutdown reminder delay", () => {
    expect(
      getNextClockDelayMs("21:30", new Date("2026-05-10T21:00:00Z")),
    ).toBe(30 * 60 * 1000);

    expect(
      getNextClockDelayMs("21:30", new Date("2026-05-10T21:30:00Z")),
    ).toBe(0);

    expect(
      getNextClockDelayMs("21:30", new Date("2026-05-10T21:31:00Z")),
    ).toBe((23 * 60 + 59) * 60 * 1000);
  });
});
