import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import process from 'node:process';

/** Workspace root exposed to local benchmark browser servers. */
const ROOT_DIRECTORY = process.cwd();

/** Starts a read-only static server for built artifacts and a benchmark HTML shell. */
function startStaticServer() {
  return new Promise((resolveServer, rejectServer) => {
    const server = createServer(async (request, response) => {
      const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
      const filePath = resolve(ROOT_DIRECTORY, `.${pathname}`);

      if (!filePath.startsWith(ROOT_DIRECTORY)) {
        response.writeHead(403).end();
        return;
      }

      try {
        const content =
          pathname === '/benchmark.html'
            ? '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>'
            : await readFile(filePath);
        const contentType = pathname.endsWith('.css')
          ? 'text/css'
          : pathname.endsWith('.mjs') || pathname.endsWith('.js')
            ? 'text/javascript'
            : 'text/html';

        response.writeHead(200, {
          'cache-control': 'no-store',
          'content-type': `${contentType}; charset=utf-8`,
        });
        response.end(content);
      } catch {
        response.writeHead(404).end();
      }
    });

    server.once('error', rejectServer);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();

      if (address === null || typeof address === 'string') {
        rejectServer(new Error('Benchmark server did not receive a TCP address.'));
        return;
      }

      resolveServer({
        close: () =>
          new Promise((resolveClose) => {
            server.close(resolveClose);
          }),
        origin: `http://127.0.0.1:${address.port}`,
      });
    });
  });
}

export { startStaticServer };
