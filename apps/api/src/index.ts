import { assertProductionConfig, env, stripAmbientProviderCredentials } from './config.js';
stripAmbientProviderCredentials();
assertProductionConfig();

const { createApp } = await import('./app.js');
const { logger } = await import('./lib/logger.js');
const { recoverInterruptedJobs, startKeepAwake, startSchedulers, startStaleJobSweeper } = await import('./services/jobs.js');

const app = createApp();
const server = app.listen(env.PORT, '0.0.0.0', () => logger.info(`Designo API listening on :${env.PORT}`));
server.requestTimeout = 330_000; // exports can take a while
recoverInterruptedJobs().catch((e) => logger.error({ err: e }, 'job recovery failed'));
startStaleJobSweeper();
(await import('./services/zetpay.js')).startZetpayReconciler();
startSchedulers();
startKeepAwake();

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => { logger.info(`${sig} received, shutting down`); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 10_000).unref(); });
}
