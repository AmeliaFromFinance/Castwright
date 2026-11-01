// Stand-in for the Castwright overlay server: serves the built page and assets and
// speaks just enough WebSocket (RFC 6455) to push messages and read replies.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { extname, join, normalize } from 'node:path';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webm': 'video/webm',
  '.wav': 'audio/wav',
  '.woff2': 'font/woff2'
};

export class MiniSocket {
  #buf = Buffer.alloc(0);
  #listeners: ((text: string) => void)[] = [];
  closed = false;
  readonly received: unknown[] = [];

  constructor(private socket: Socket) {
    socket.on('data', (d: Buffer) => this.#onData(d));
    socket.on('close', () => (this.closed = true));
    socket.on('error', () => (this.closed = true));
  }

  send(msg: unknown): void {
    if (this.closed) return;
    const payload = Buffer.from(typeof msg === 'string' ? msg : JSON.stringify(msg));
    this.socket.write(Buffer.concat([this.#header(0x1, payload.length), payload]));
  }

  close(): void {
    if (this.closed) return;
    this.socket.write(this.#header(0x8, 0));
    this.socket.end();
    this.closed = true;
  }

  onMessage(fn: (text: string) => void): void {
    this.#listeners.push(fn);
  }

  #header(opcode: number, len: number): Buffer {
    if (len < 126) return Buffer.from([0x80 | opcode, len]);
    if (len < 65536) {
      const b = Buffer.alloc(4);
      b[0] = 0x80 | opcode;
      b[1] = 126;
      b.writeUInt16BE(len, 2);
      return b;
    }
    const b = Buffer.alloc(10);
    b[0] = 0x80 | opcode;
    b[1] = 127;
    b.writeBigUInt64BE(BigInt(len), 2);
    return b;
  }

  #onData(d: Buffer): void {
    this.#buf = Buffer.concat([this.#buf, d]);
    for (;;) {
      if (this.#buf.length < 2) return;
      const opcode = this.#buf[0]! & 0x0f;
      const masked = (this.#buf[1]! & 0x80) !== 0;
      let len = this.#buf[1]! & 0x7f;
      let off = 2;
      if (len === 126) {
        if (this.#buf.length < 4) return;
        len = this.#buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (this.#buf.length < 10) return;
        len = Number(this.#buf.readBigUInt64BE(2));
        off = 10;
      }
      const maskLen = masked ? 4 : 0;
      if (this.#buf.length < off + maskLen + len) return;
      const mask = this.#buf.subarray(off, off + maskLen);
      const payload = Buffer.from(this.#buf.subarray(off + maskLen, off + maskLen + len));
      if (masked) for (let i = 0; i < payload.length; i++) payload[i] = (payload[i] ?? 0) ^ (mask[i % 4] ?? 0);
      this.#buf = this.#buf.subarray(off + maskLen + len);
      if (opcode === 0x1) {
        const text = payload.toString('utf8');
        try {
          this.received.push(JSON.parse(text));
        } catch {
          this.received.push(text);
        }
        for (const fn of this.#listeners) fn(text);
      } else if (opcode === 0x8) {
        this.close();
      } else if (opcode === 0x9) {
        this.socket.write(Buffer.concat([this.#header(0xa, payload.length), payload]));
      }
    }
  }
}

export interface TestServer {
  url: string;
  sockets: MiniSocket[];
  /** Resolves with the next socket that connects. */
  nextSocket(): Promise<MiniSocket>;
  close(): Promise<void>;
}

export function startServer(opts: { distDir: string; token: string; assets: Record<string, Buffer | string> }): Promise<TestServer> {
  const sockets: MiniSocket[] = [];
  let waiters: ((s: MiniSocket) => void)[] = [];

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const send = (code: number, body: Buffer | string, type = 'text/plain') => {
      res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
      res.end(body);
    };
    if (url.pathname === '/favicon.ico') return send(204, '');
    if (url.pathname.startsWith('/overlay/')) {
      if (url.searchParams.get('token') !== opts.token) return send(403, 'bad token');
      return send(200, readFileSync(join(opts.distDir, 'overlay.html')), MIME['.html']);
    }
    if (url.pathname.startsWith('/_app/')) {
      const file = normalize(join(opts.distDir, decodeURIComponent(url.pathname)));
      if (!file.startsWith(opts.distDir) || !existsSync(file)) return send(404, 'not found');
      return send(200, readFileSync(file), MIME[extname(file)] ?? 'application/octet-stream');
    }
    if (url.pathname.startsWith('/assets/')) {
      if (url.searchParams.get('token') !== opts.token) return send(403, 'bad token');
      const name = decodeURIComponent(url.pathname.slice('/assets/'.length));
      const body = opts.assets[name];
      if (body === undefined) return send(404, 'no asset');
      return send(200, body, MIME[extname(name)] ?? 'application/octet-stream');
    }
    send(404, 'not found');
  });

  server.on('upgrade', (req: IncomingMessage, socket: Socket) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const key = req.headers['sec-websocket-key'];
    if (url.pathname !== '/ws' || url.searchParams.get('token') !== opts.token || typeof key !== 'string') {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    const accept = createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    socket.setNoDelay(true);
    const ws = new MiniSocket(socket);
    sockets.push(ws);
    const w = waiters;
    waiters = [];
    for (const fn of w) fn(ws);
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        sockets,
        nextSocket: () => new Promise((r) => waiters.push(r)),
        close: () =>
          new Promise((r) => {
            for (const s of sockets) s.close();
            server.closeAllConnections();
            server.close(() => r());
          })
      });
    });
  });
}
