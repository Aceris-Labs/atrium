import { toast } from "./components/Toast";

const IPC_PREFIX_RE = /^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/;

function cleanMessage(raw: string): string {
  return raw.replace(IPC_PREFIX_RE, "").trim();
}

function messageFrom(value: unknown): string {
  if (value instanceof Error) return cleanMessage(value.message);
  if (typeof value === "string") return cleanMessage(value);
  try {
    return cleanMessage(String(value));
  } catch {
    return "Unknown error";
  }
}

export function setupErrorHandlers(): void {
  window.addEventListener("unhandledrejection", (event) => {
    const msg = messageFrom(event.reason);
    if (!msg) return;
    console.error("[unhandledrejection]", event.reason);
    toast().error(msg);
  });

  window.addEventListener("error", (event) => {
    const msg = messageFrom(event.error ?? event.message);
    if (!msg) return;
    console.error("[window.error]", event.error ?? event.message);
    toast().error(msg);
  });

  if (window.api?.errors?.onError) {
    window.api.errors.onError((message) => {
      toast().error(cleanMessage(message));
    });
  }
}
