import { parseClockTime } from "../sleep";

export type ShutdownNotificationSupportInput = {
  isSecureContext: boolean;
  hasNotification: boolean;
  hasServiceWorker: boolean;
  hasShowNotification: boolean;
};

export type ShutdownNotificationSupport =
  | {
      supported: true;
      message: string;
    }
  | {
      supported: false;
      message: string;
    };

export function resolveShutdownNotificationSupport({
  isSecureContext,
  hasNotification,
  hasServiceWorker,
  hasShowNotification,
}: ShutdownNotificationSupportInput): ShutdownNotificationSupport {
  if (!isSecureContext) {
    return {
      supported: false,
      message: "Shutdown reminders require a secure browser context.",
    };
  }

  if (!hasNotification) {
    return {
      supported: false,
      message: "Notifications are not supported in this browser.",
    };
  }

  if (!hasServiceWorker || !hasShowNotification) {
    return {
      supported: false,
      message: "This browser cannot show SleepOps reminders from the app shell.",
    };
  }

  return {
    supported: true,
    message: "Notifications are available for shutdown reminders.",
  };
}

export function getNextClockDelayMs(clockTime: string, now: Date): number {
  const targetMinutes = parseClockTime(clockTime);
  const target = new Date(now);
  target.setHours(Math.floor(targetMinutes / 60), targetMinutes % 60, 0, 0);

  if (target.getTime() < now.getTime()) {
    target.setDate(target.getDate() + 1);
  }

  return target.getTime() - now.getTime();
}
