import process from 'node:process';
import { createServer } from 'vite';

/** Creates the Vite SSR loader used by source-level benchmark profiles. */
async function createBenchmarkViteServer({ version = '0.1.0-benchmark' } = {}) {
  const server = await createServer({
    appType: 'custom',
    configFile: false,
    define: {
      __RXT_TRACKER_DEBUG__: 'false',
      __RXT_TRACKER_VERSION__: JSON.stringify(version),
    },
    logLevel: 'silent',
    root: process.cwd(),
    server: { middlewareMode: true },
  });

  return {
    close: () => server.close(),
    ssrLoadModule: (path) => server.ssrLoadModule(path),
  };
}

export { createBenchmarkViteServer };
