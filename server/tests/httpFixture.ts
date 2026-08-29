import http from 'node:http';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export type Fixture = {
  origin: string;
  /** Сколько раз обработан каждый путь — для проверки ретраев. */
  hits: Map<string, number>;
  /** Пути, которые должны упасть заданное число первых раз. */
  failFirst: Map<string, number>;
  close: () => Promise<void>;
};

/**
 * Мишень для тестов раннера: умеет тормозить, падать, рвать соединение и редиректить.
 * Локальный сервер вместо внешних URL делает тесты быстрыми и независимыми от сети.
 */
export async function startFixture(options: { tls?: boolean } = {}): Promise<Fixture> {
  const hits = new Map<string, number>();
  const failFirst = new Map<string, number>();

  const handler: http.RequestListener = async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const route = url.pathname;
    hits.set(route, (hits.get(route) ?? 0) + 1);

    const remainingFailures = failFirst.get(route) ?? 0;
    if (remainingFailures > 0) {
      failFirst.set(route, remainingFailures - 1);
      res.socket?.destroy();
      return;
    }

    switch (route) {
      case '/ok':
        res.writeHead(200, { 'content-type': 'application/json', 'x-request-id': 'abc' });
        res.end('{"status":"ok","count":3}');
        return;

      case '/slow':
        await delay(Number(url.searchParams.get('ms') ?? 50));
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('slow but alive');
        return;

      case '/500':
        res.writeHead(500, { 'content-type': 'text/plain' });
        res.end('boom');
        return;

      case '/reset':
        res.socket?.destroy();
        return;

      case '/redirect':
        res.writeHead(302, { location: '/ok' });
        res.end();
        return;

      case '/echo': {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            method: req.method,
            headers: req.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
        return;
      }

      case '/big':
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('x'.repeat(200_000));
        return;

      default:
        res.writeHead(404);
        res.end('not found');
    }
  };

  const server = options.tls ? https.createServer(selfSignedCert(), handler) : http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Сервер не отдал порт');

  const scheme = options.tls ? 'https' : 'http';
  return {
    origin: `${scheme}://localhost:${address.port}`,
    hits,
    failFirst,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

let cachedCert: { key: string; cert: string } | null = null;

function selfSignedCert(): { key: string; cert: string } {
  if (cachedCert) return cachedCert;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'monitoring-tls-'));
  const keyPath = path.join(dir, 'key.pem');
  const certPath = path.join(dir, 'cert.pem');
  try {
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', keyPath, '-out', certPath,
      '-days', '2', '-subj', '/CN=localhost',
      '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
    ], { stdio: 'ignore' });
  } catch (error) {
    throw new Error(
      `Для https-тестов нужен openssl в PATH. Исходная ошибка: ${(error as Error).message}`,
    );
  }

  cachedCert = { key: fs.readFileSync(keyPath, 'utf8'), cert: fs.readFileSync(certPath, 'utf8') };
  return cachedCert;
}
