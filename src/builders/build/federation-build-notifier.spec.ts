import type { IncomingMessage, ServerResponse } from "http";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@softarc/native-federation/internal", () => ({
  logger: { info: vi.fn(), verbose: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { BuildNotificationType } from "@softarc/native-federation";

import { federationBuildNotifier } from "./federation-build-notifier.js";

const ENDPOINT = "/@angular-architects/native-federation:build-notifications";

// Minimal stand-ins for the node req/res pair: the notifier only writes to the response
// and subscribes to the request's close/error events.
function createClient() {
  const listeners = new Map<string, () => void>();
  const written: string[] = [];

  const req = {
    destroyed: false,
    on(event: string, callback: () => void) {
      listeners.set(event, callback);
      return req;
    },
  } as unknown as IncomingMessage;

  const res = {
    destroyed: false,
    writable: true,
    writeHead: vi.fn(),
    write: vi.fn((chunk: string) => {
      written.push(chunk);
      return true;
    }),
    end: vi.fn(() => {
      res.destroyed = true;
      res.writable = false;
    }),
  };

  return {
    req,
    res: res as unknown as ServerResponse,
    written,
    ended: () => res.end.mock.calls.length > 0,
    fire: (event: string) => listeners.get(event)?.(),
  };
}

function connect(clients: number) {
  const middleware = federationBuildNotifier.createEventMiddleware(() => ENDPOINT);
  const next = vi.fn();

  return Array.from({ length: clients }, () => {
    const client = createClient();
    middleware(client.req, client.res, next);
    return client;
  });
}

// The notifier is a module-level singleton, so each test has to hand back a clean pool.
afterEach(() => {
  federationBuildNotifier.stopEventServer();
  vi.clearAllMocks();
});

describe("createEventMiddleware", () => {
  it("passes the request along when the notifier is inactive", () => {
    const middleware = federationBuildNotifier.createEventMiddleware(() => ENDPOINT);
    const client = createClient();
    const next = vi.fn();

    middleware(client.req, client.res, next);

    expect(next).toHaveBeenCalled();
    expect(client.res.writeHead).not.toHaveBeenCalled();
  });

  it("passes the request along when the url is not the endpoint", () => {
    federationBuildNotifier.initialize(ENDPOINT);
    const middleware = federationBuildNotifier.createEventMiddleware(() => "/main.js");
    const client = createClient();
    const next = vi.fn();

    middleware(client.req, client.res, next);

    expect(next).toHaveBeenCalled();
    expect(client.res.writeHead).not.toHaveBeenCalled();
  });

  it("opens an event stream on the endpoint", () => {
    federationBuildNotifier.initialize(ENDPOINT);

    const [client] = connect(1);

    expect(client!.res.writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({ "Content-Type": "text/event-stream" }),
    );
    expect(federationBuildNotifier.activeConnections).toBe(1);
  });

  it("declares the reconnect delay before the first event", () => {
    federationBuildNotifier.initialize(ENDPOINT);

    const [client] = connect(1);

    expect(client!.written[0]).toBe("retry: 5000\n");
    expect(client!.written[1]).toContain('"type":"connected"');
  });

  it("drops a connection from the pool when the request closes", () => {
    federationBuildNotifier.initialize(ENDPOINT);
    const [client] = connect(1);

    client!.fire("close");

    expect(federationBuildNotifier.activeConnections).toBe(0);
  });
});

describe("connection limit", () => {
  it("holds at most 16 connections", () => {
    federationBuildNotifier.initialize(ENDPOINT);

    connect(20);

    expect(federationBuildNotifier.activeConnections).toBe(16);
  });

  it("evicts the oldest connection rather than refusing the newest", () => {
    federationBuildNotifier.initialize(ENDPOINT);

    const clients = connect(17);

    expect(clients[0]!.ended()).toBe(true);
    expect(clients[16]!.ended()).toBe(false);
  });

  it("stops broadcasting to an evicted connection", () => {
    federationBuildNotifier.initialize(ENDPOINT);
    const clients = connect(17);
    const evicted = clients[0]!;
    const writesBefore = evicted.written.length;

    federationBuildNotifier.broadcastBuildCompletion();

    expect(evicted.written.length).toBe(writesBefore);
    expect(clients[16]!.written.at(-1)).toContain(BuildNotificationType.COMPLETED);
  });
});

describe("broadcasts", () => {
  it("sends the completion event to every connection", () => {
    federationBuildNotifier.initialize(ENDPOINT);
    const clients = connect(3);

    federationBuildNotifier.broadcastBuildCompletion();

    for (const client of clients) {
      expect(client.written.at(-1)).toContain(BuildNotificationType.COMPLETED);
    }
  });

  it("sends the error message with the error event", () => {
    federationBuildNotifier.initialize(ENDPOINT);
    const [client] = connect(1);

    federationBuildNotifier.broadcastBuildError(new Error("boom"));

    expect(client!.written.at(-1)).toContain(BuildNotificationType.ERROR);
    expect(client!.written.at(-1)).toContain("boom");
  });

  it("does nothing when the notifier is inactive", () => {
    const [client] = connect(1);
    const writesBefore = client!.written.length;

    federationBuildNotifier.broadcastBuildCancellation();

    expect(client!.written.length).toBe(writesBefore);
  });
});

describe("stopEventServer", () => {
  it("closes every connection and empties the pool", () => {
    federationBuildNotifier.initialize(ENDPOINT);
    const clients = connect(3);

    federationBuildNotifier.stopEventServer();

    expect(clients.every((client) => client.ended())).toBe(true);
    expect(federationBuildNotifier.activeConnections).toBe(0);
    expect(federationBuildNotifier.isRunning).toBe(false);
  });
});
