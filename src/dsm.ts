/**
 * The DSM Web API: one session per NAS, kept while it works and renewed when
 * DSM ends it. Requests are POSTed, so the password is never in a URL.
 *
 * The request itself is a function passed in, so the tests answer with
 * recorded responses and nothing here needs a NAS.
 */
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

import type { NasConfig } from './config.ts';

export type Params = Record<string, string | number>;

/** POSTs a form to entry.cgi and resolves with the parsed JSON. */
export type Transport = (params: Params) => Promise<unknown>;

/** DSM said no, with one of its error codes. */
export class DsmError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

/** DSM's own codes, in words for the log. */
const MESSAGES: Record<number, string> = {
  100: 'unknown error',
  101: 'no parameter of API, method or version',
  102: 'the API does not exist',
  103: 'the method does not exist',
  104: 'this version of the API is not supported',
  105: 'the account has no permission for this; shutting down and restarting need an administrator',
  106: 'the session timed out',
  107: 'the session was interrupted by a login elsewhere',
  119: 'the session is no longer valid',
  400: 'wrong username or password',
  401: 'the account is disabled',
  402: 'permission denied',
  403: 'the account uses 2-step verification; use one without it',
  404: '2-step verification failed',
  406: '2-step verification is enforced for this account; use one without it',
  407: 'this address is blocked by DSM after too many failed logins',
  408: 'the password has expired and must be changed',
  409: 'the password has expired',
  410: 'the password must be changed',
};

export const describe = (code: number): string => MESSAGES[code] ?? `error ${code}`;

/** Codes after which a new login is worth a try. */
const SESSION_GONE = new Set([106, 107, 119]);

/** The session name in DSM's list of connections. */
const SESSION = 'SynologyMonitor';

export class DsmClient {
  readonly #transport: Transport;
  readonly #config: NasConfig;
  #sid: string | undefined;
  #login: Promise<string> | undefined;

  constructor(config: NasConfig, transport: Transport = httpTransport(config)) {
    this.#config = config;
    this.#transport = transport;
  }

  get loggedIn(): boolean {
    return this.#sid !== undefined;
  }

  /** Calls a method with the session, logging in first if need be and once more if DSM ended the session. */
  async call(api: string, version: number, method: string, extra: Params = {}): Promise<unknown> {
    try {
      return await this.#call(await this.#session(), api, version, method, extra);
    } catch (error) {
      if (!(error instanceof DsmError) || !SESSION_GONE.has(error.code)) {
        throw error;
      }
      this.#sid = undefined;
      return this.#call(await this.#session(), api, version, method, extra);
    }
  }

  /** Ends the session, if there is one; never fails. */
  async logout(): Promise<void> {
    const sid = this.#sid;
    this.#sid = undefined;
    if (sid) {
      await this.#transport({ api: 'SYNO.API.Auth', version: 6, method: 'logout', session: SESSION, _sid: sid }).catch(() => undefined);
    }
  }

  /** Forgets the session without telling DSM, as when the NAS went away. */
  forget(): void {
    this.#sid = undefined;
  }

  async #call(sid: string, api: string, version: number, method: string, extra: Params): Promise<unknown> {
    return unwrap(await this.#transport({ api, version, method, ...extra, _sid: sid }));
  }

  /** One login at a time: a poll and a button pressed together share it. */
  #session(): Promise<string> {
    if (this.#sid) {
      return Promise.resolve(this.#sid);
    }
    this.#login ??= this.#transport({
      api: 'SYNO.API.Auth',
      version: 6,
      method: 'login',
      account: this.#config.username,
      passwd: this.#config.password,
      session: SESSION,
      format: 'sid',
    })
      .then((answer) => {
        const sid = (unwrap(answer) as { sid?: unknown }).sid;
        if (typeof sid !== 'string' || !sid) {
          throw new DsmError(100, 'DSM logged in without a session');
        }
        this.#sid = sid;
        return sid;
      })
      .finally(() => {
        this.#login = undefined;
      });
    return this.#login;
  }
}

/** The `data` of a successful answer, or a DsmError with the code of a failed one. */
export function unwrap(answer: unknown): unknown {
  const body = (answer && typeof answer === 'object' ? answer : {}) as { success?: unknown; data?: unknown; error?: unknown };
  if (body.success === true) {
    return body.data ?? {};
  }
  const code = Number((body.error as { code?: unknown } | undefined)?.code ?? 100);
  throw new DsmError(code, describe(code));
}

/** The real transport: a form POSTed to `/webapi/entry.cgi` over HTTP or HTTPS. */
export function httpTransport(config: NasConfig, timeoutMs = 15000): Transport {
  const send = config.protocol === 'https' ? httpsRequest : httpRequest;
  return (params) =>
    new Promise((resolve, reject) => {
      const body = new URLSearchParams(Object.entries(params).map(([key, value]): [string, string] => [key, String(value)])).toString();
      const request = send(
        {
          host: config.host,
          port: config.port,
          path: '/webapi/entry.cgi',
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
          timeout: timeoutMs,
          rejectUnauthorized: config.checkCertificate,
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () => {
            try {
              resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
            } catch {
              reject(new Error(`DSM answered HTTP ${response.statusCode} without JSON`));
            }
          });
          response.on('error', reject);
        },
      );
      request.on('timeout', () => request.destroy(new Error(`no answer within ${timeoutMs / 1000} s`)));
      request.on('error', reject);
      request.end(body);
    });
}
