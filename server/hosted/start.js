import { createHostedServer } from './server.js';

let hosted;
try {
  hosted = await createHostedServer();
  await new Promise((resolve, reject) => {
    hosted.server.once('error', reject);
    hosted.server.listen(hosted.port, hosted.bindHost, resolve);
  });
  console.info(`[hosted] God's Eye View is listening on port ${hosted.port}`);
} catch {
  // Do not put environment values, credentials, filesystem paths or stacks in
  // a public hosting log. Configuration requirements are documented in HOSTING.
  console.error(
    '[hosted] Startup failed. Check the HTTPS public origin, access password, port, and production build.',
  );
  process.exitCode = 1;
  if (hosted) await hosted.close();
}

if (hosted?.server.listening) {
  const shutdown = async () => {
    await hosted.close();
    process.exit(0);
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
