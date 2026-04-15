import type {
  PlannerClientMessage,
  PlannerRequestMethod,
  PlannerRequestPayloadMap,
  PlannerResponseMessage,
  PlannerResponsePayloadMap,
  PlannerServerEventMessage,
} from "@shared/messages";

interface VsCodeApi<State> {
  postMessage(message: unknown): void;
  setState(state: State): void;
  getState(): State | undefined;
}

declare global {
  interface Window {
    acquireVsCodeApi?: <State>() => VsCodeApi<State>;
  }
}

const vscodeApi = window.acquireVsCodeApi?.<unknown>();
const eventListeners = new Set<(message: PlannerServerEventMessage) => void>();
const pendingRequests = new Map<
  string,
  {
    resolve: (value: any) => void;
    reject: (reason?: unknown) => void;
  }
>();

window.addEventListener("message", (event: MessageEvent<PlannerResponseMessage | PlannerServerEventMessage>) => {
  const message = event.data;
  if (!message || typeof message !== "object") {
    return;
  }

  if (message.type === "response") {
    const pending = pendingRequests.get(message.id);
    if (!pending) {
      return;
    }

    pendingRequests.delete(message.id);
    if (message.ok) {
      pending.resolve(message.result);
    } else {
      pending.reject(new Error(message.error));
    }
    return;
  }

  if (message.type === "event") {
    eventListeners.forEach((listener) => listener(message));
  }
});

export function callPlanner<TMethod extends PlannerRequestMethod>(
  method: TMethod,
  payload: PlannerRequestPayloadMap[TMethod],
): Promise<PlannerResponsePayloadMap[TMethod]> {
  const id = `planner-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const message: PlannerClientMessage = {
    type: "request",
    id,
    method,
    payload,
  };

  return new Promise((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject });
    vscodeApi?.postMessage(message);
  }) as Promise<PlannerResponsePayloadMap[TMethod]>;
}

export function onPlannerEvent(listener: (message: PlannerServerEventMessage) => void): () => void {
  eventListeners.add(listener);
  return () => eventListeners.delete(listener);
}

export function saveWebviewState<T>(state: T): void {
  vscodeApi?.setState(state);
}

export function loadWebviewState<T>(): T | undefined {
  return vscodeApi?.getState() as T | undefined;
}
