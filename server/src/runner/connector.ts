import net from 'node:net';
import tls from 'node:tls';
import type { buildConnector } from 'undici';

export type CertificateInfo = {
  issuer: string | null;
  subject: string | null;
  validFrom: Date | null;
  validTo: Date | null;
  daysRemaining: number | null;
};

export type ConnectionTimings = {
  connectMs: number | null;
  tlsMs: number | null;
  certificate: CertificateInfo | null;
};

export function emptyTimings(): ConnectionTimings {
  return { connectMs: null, tlsMs: null, certificate: null };
}

type ConnectorOptions = buildConnector.Options;
type ConnectorCallback = buildConnector.Callback;

/**
 * Собственный коннектор для undici. Нужен, чтобы разделить фазы TCP и TLS: штатный
 * коннектор отдаёт только суммарное время соединения, а нам важно видеть, что именно
 * тормозит — сеть или handshake. Заодно снимает сертификат прямо с живого соединения,
 * поэтому срок его действия известен после каждой https-проверки.
 */
export function createTimedConnector(
  timings: ConnectionTimings,
  options: { rejectUnauthorized: boolean; connectTimeoutMs: number },
) {
  return function connect(connectorOptions: ConnectorOptions, callback: ConnectorCallback) {
    const isTls = connectorOptions.protocol === 'https:';
    const host = connectorOptions.hostname;
    const port = Number(connectorOptions.port) || (isTls ? 443 : 80);
    const startedAt = performance.now();
    let tcpEstablishedAt = 0;
    let settled = false;

    const settle = (error: Error | null, connected: net.Socket | null) => {
      if (settled) return;
      settled = true;
      connected?.setTimeout(0);
      connected?.removeListener('error', onError);
      connected?.removeListener('timeout', onTimeout);
      if (error) callback(error, null);
      else callback(null, connected!);
    };

    const onError = (error: Error) => {
      socket.destroy();
      settle(error, null);
    };

    const onTimeout = () => {
      const error = Object.assign(new Error('Таймаут установки соединения'), {
        code: 'UND_ERR_CONNECT_TIMEOUT',
      });
      socket.destroy();
      settle(error, null);
    };

    let socket: net.Socket;
    if (isTls) {
      const tlsSocket = tls.connect({
        host,
        port,
        servername: connectorOptions.servername ?? (net.isIP(host) ? undefined : host),
        ALPNProtocols: ['http/1.1'],
        rejectUnauthorized: options.rejectUnauthorized,
      });
      tlsSocket.on('connect', () => {
        timings.connectMs = elapsed(startedAt);
        tcpEstablishedAt = performance.now();
      });
      tlsSocket.on('secureConnect', () => {
        timings.tlsMs = elapsed(tcpEstablishedAt);
        timings.certificate = readCertificate(tlsSocket);
        settle(null, tlsSocket);
      });
      socket = tlsSocket;
    } else {
      socket = net.connect({ host, port });
      socket.on('connect', () => {
        timings.connectMs = elapsed(startedAt);
        settle(null, socket);
      });
    }

    socket.setNoDelay(true);
    socket.setTimeout(options.connectTimeoutMs);
    socket.on('timeout', onTimeout);
    socket.on('error', onError);
    return socket;
  };
}

function readCertificate(socket: tls.TLSSocket): CertificateInfo | null {
  const certificate = socket.getPeerCertificate(false);
  if (!certificate || Object.keys(certificate).length === 0) return null;

  const validTo = certificate.valid_to ? new Date(certificate.valid_to) : null;
  const validFrom = certificate.valid_from ? new Date(certificate.valid_from) : null;

  return {
    issuer: formatName(certificate.issuer),
    subject: formatName(certificate.subject),
    validFrom: isValidDate(validFrom) ? validFrom : null,
    validTo: isValidDate(validTo) ? validTo : null,
    daysRemaining: isValidDate(validTo)
      ? Math.floor((validTo.getTime() - Date.now()) / 86_400_000)
      : null,
  };
}

function formatName(name: tls.PeerCertificate['issuer'] | undefined): string | null {
  if (!name) return null;
  const value = name.CN ?? name.O;
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function isValidDate(value: Date | null): value is Date {
  return value !== null && !Number.isNaN(value.getTime());
}

function elapsed(from: number): number {
  return Math.round(performance.now() - from);
}
