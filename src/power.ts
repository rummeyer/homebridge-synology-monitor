/**
 * Whether the NAS is on, as the Power switch shows it. It is on while DSM
 * answers — but a NAS just woken takes minutes before it does, and one just
 * shut down answers for a while yet. So after a wake, a shutdown or a restart
 * the switch shows where the NAS is going until it got there or the time for
 * it is up, rather than flipping back in between.
 *
 * Time is passed in, so this is tested without waiting.
 */

/** What the dashboard says; HomeKit's switch is on for on, starting and restarting. */
export type PowerState = 'on' | 'off' | 'starting' | 'stopping' | 'restarting';

interface Pending {
  state: 'starting' | 'stopping' | 'restarting';
  until: number;
  /** For a restart: whether the NAS has been away yet, after which answering again means it is back. */
  wentAway: boolean;
}

export class PowerTracker {
  #reachable = false;
  #pending: Pending | undefined;

  /** What the last check found. */
  seen(reachable: boolean, now: number): void {
    this.#reachable = reachable;
    const pending = this.#pending;
    if (!pending) {
      return;
    }
    if (now >= pending.until) {
      this.#pending = undefined;
    } else if (pending.state === 'starting' && reachable) {
      this.#pending = undefined;
    } else if (pending.state === 'stopping' && !reachable) {
      this.#pending = undefined;
    } else if (pending.state === 'restarting') {
      if (!reachable) {
        pending.wentAway = true;
      } else if (pending.wentAway) {
        this.#pending = undefined;
      }
    }
  }

  /** The NAS was woken, shut down or restarted; for how long to wait for it, in seconds. */
  expect(state: Pending['state'], seconds: number, now: number): void {
    this.#pending = seconds > 0 ? { state, until: now + seconds * 1000, wentAway: false } : undefined;
  }

  state(now: number): PowerState {
    if (this.#pending && now < this.#pending.until) {
      return this.#pending.state;
    }
    return this.#reachable ? 'on' : 'off';
  }

  /** The Power switch: on while on, starting or restarting. */
  isOn(now: number): boolean {
    const state = this.state(now);
    return state === 'on' || state === 'starting' || state === 'restarting';
  }

  get reachable(): boolean {
    return this.#reachable;
  }
}
