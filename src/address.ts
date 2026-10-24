/**
 * This machine's address on the network, for the link to the dashboard on
 * the settings page; as Appliance Monitor finds it.
 */
import { createSocket } from 'node:dgram';
import { networkInterfaces } from 'node:os';

/**
 * The address the default route leaves from, which a UDP socket "connected"
 * outwards tells without sending anything — not the first of all of them,
 * which may be a Docker bridge. Without a route, the first IPv4 address
 * that is not loopback; without that, null.
 */
export async function ownAddress(): Promise<string | null> {
  const routed = await new Promise<string | undefined>((resolve) => {
    const socket = createSocket('udp4');
    const done = (address: string | undefined): void => {
      socket.close();
      resolve(address);
    };
    socket.on('error', () => done(undefined));
    socket.connect(53, '192.0.2.1', () => done(socket.address().address));
  });
  if (routed && routed !== '0.0.0.0') {
    return routed;
  }
  return (
    Object.values(networkInterfaces())
      .flat()
      .find((entry) => entry && entry.family === 'IPv4' && !entry.internal)?.address ?? null
  );
}

