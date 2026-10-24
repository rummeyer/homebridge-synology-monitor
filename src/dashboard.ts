/**
 * A page for a browser on the home network, as nas-control has: whether each
 * NAS is on, what it reads, and buttons to wake it, shut it down and restart
 * it. Served by the plugin itself, without the Homebridge login.
 *
 * The buttons are the only thing that changes anything, and they answer only
 * POSTs from a private, link-local or loopback address, as nas-control lets
 * in. They also want a JSON body: a form on another website can only send
 * one after a CORS preflight, which this server never answers, so a page
 * opened elsewhere in the same browser cannot press them.
 */
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';

import type { NasMonitor, NasSnapshot } from './monitor.ts';
import { isLocalAddress } from './network.ts';

export interface DashboardSource {
  monitors(): NasMonitor[];
  /** Whether the buttons are there. */
  controls: boolean;
}

const read = (path: string): Buffer => readFileSync(new URL(`../${path}`, import.meta.url));

/** The version of the plugin running, read when it starts. */
const VERSION = String((JSON.parse(read('package.json').toString('utf8')) as { version?: unknown }).version ?? '');

const FILES: Record<string, { type: string; path: string }> = {
  '/': { type: 'text/html; charset=utf-8', path: 'web/index.html' },
  '/dashboard.js': { type: 'text/javascript; charset=utf-8', path: 'web/dashboard.js' },
  '/theme.js': { type: 'text/javascript; charset=utf-8', path: 'web/theme.js' },
  '/icon.png': { type: 'image/png', path: 'web/icon.png' },
  '/home.svg': { type: 'image/svg+xml', path: 'web/home.svg' },
};

const HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'",
};

/** What a button does, by the last part of its path. */
const ACTIONS = {
  wake: (monitor: NasMonitor) => monitor.powerOn(),
  shutdown: (monitor: NasMonitor) => monitor.powerOff(),
  restart: (monitor: NasMonitor) => monitor.restart(),
} as const;

/** What the page is sent: every NAS, and whether it has buttons. */
export interface DashboardState {
  version: string;
  controls: boolean;
  nas: NasSnapshot[];
}

export class Dashboard {
  readonly #source: DashboardSource;
  readonly #server: Server;

  constructor(source: DashboardSource) {
    this.#source = source;
    this.#server = createServer((request, response) => {
      this.#handle(request, response).catch(() => send(response, 500, 'text/plain; charset=utf-8', 'Something went wrong'));
    });
  }

  /** Starts listening on every interface; fails if the port is taken. */
  listen(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.#server.once('error', reject);
      this.#server.listen(port, () => {
        this.#server.off('error', reject);
        resolve();
      });
    });
  }

  get port(): number | undefined {
    const address = this.#server.address();
    return typeof address === 'object' && address ? address.port : undefined;
  }

  close(): void {
    this.#server.close();
    this.#server.closeAllConnections();
  }

  state(): DashboardState {
    return { version: VERSION, controls: this.#source.controls, nas: this.#source.monitors().map((monitor) => monitor.snapshot()) };
  }

  async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://dashboard');
    if (request.method === 'POST') {
      await this.#act(request, response, url.pathname);
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      send(response, 405, 'text/plain; charset=utf-8', 'Not allowed', { Allow: 'GET, HEAD, POST' });
      return;
    }
    const file = FILES[url.pathname];
    if (file) {
      send(response, 200, file.type, read(file.path));
    } else if (url.pathname === '/state') {
      send(response, 200, 'application/json; charset=utf-8', JSON.stringify(this.state()));
    } else {
      send(response, 404, 'text/plain; charset=utf-8', 'Not found');
    }
  }

  /** `POST /nas/<index>/<wake|shutdown|restart>` with a JSON body, from the home network. */
  async #act(request: IncomingMessage, response: ServerResponse, path: string): Promise<void> {
    request.resume();
    const match = /^\/nas\/(\d+)\/(wake|shutdown|restart)$/.exec(path);
    const monitor = match ? this.#source.monitors()[Number(match[1])] : undefined;
    if (!match || !monitor) {
      json(response, 404, { error: 'No such NAS or action' });
      return;
    }
    if (!this.#source.controls) {
      json(response, 403, { error: 'The buttons are switched off in the settings' });
      return;
    }
    if (!isLocalAddress(request.socket.remoteAddress)) {
      json(response, 403, { error: 'Only from the home network' });
      return;
    }
    if (!/^application\/json\b/i.test(request.headers['content-type'] ?? '')) {
      json(response, 415, { error: 'Send JSON' });
      return;
    }
    try {
      await ACTIONS[match[2] as keyof typeof ACTIONS](monitor);
      json(response, 200, { ok: true, nas: monitor.snapshot() });
    } catch (error) {
      json(response, 502, { error: (error as Error).message });
    }
  }
}

function json(response: ServerResponse, status: number, body: unknown): void {
  send(response, status, 'application/json; charset=utf-8', JSON.stringify(body));
}

function send(response: ServerResponse, status: number, type: string, body: string | Buffer, extra: Record<string, string> = {}): void {
  if (response.headersSent) {
    return;
  }
  response.writeHead(status, { ...HEADERS, 'Content-Type': type, ...extra });
  response.end(response.req.method === 'HEAD' ? undefined : body);
}
