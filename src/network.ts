/**
 * Wake-on-LAN and whether the NAS answers, as nas-control does them: a magic
 * packet broadcast to UDP port 9, and a TCP connection to DSM's port.
 */
import { createSocket } from 'node:dgram';
import { connect } from 'node:net';

/** Six bytes 0xFF, then the MAC sixteen times. */
export function magicPacket(mac: string): Buffer {
  const bytes = Buffer.from(mac.split(/[:-]/).map((part) => parseInt(part, 16)));
  if (bytes.length !== 6 || bytes.some((byte) => Number.isNaN(byte))) {
    throw new Error(`"${mac}" is not a MAC address`);
  }
  return Buffer.concat([Buffer.alloc(6, 0xff), ...Array.from({ length: 16 }, () => bytes)]);
}

/** Sends the magic packet for *mac* to *broadcast* on port 9. */
export function wake(mac: string, broadcast: string): Promise<void> {
  const packet = magicPacket(mac);
  return new Promise((resolve, reject) => {
    const socket = createSocket('udp4');
    socket.once('error', (error) => {
      socket.close();
      reject(error);
    });
    socket.bind(() => {
      socket.setBroadcast(true);
      socket.send(packet, 9, broadcast, (error) => {
        socket.close();
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  });
}

/** Whether something accepts a TCP connection on *host*:*port* within *timeoutMs*. */
export function reachable(host: string, port: number, timeoutMs = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const done = (answer: boolean): void => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(answer);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

/**
 * Whether *address* is on the home network: a private, link-local or
 * loopback address, as nas-control lets in. The dashboard's buttons answer
 * only those.
 */
export function isLocalAddress(address: string | undefined): boolean {
  if (!address) {
    return false;
  }
  const ip = address.startsWith('::ffff:') ? address.slice(7) : address;
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(ip);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  const lower = ip.toLowerCase();
  return lower === '::1' || /^f[cd][0-9a-f]{2}:/.test(lower) || /^fe[89ab][0-9a-f]:/.test(lower);
}
