// @flow

const ps = require('ps-node');
const logger = require('./logger')('FFmpeg Process Manager');

const checkIfProcessExists = (pid:number): Promise<boolean> => new Promise((resolve, reject) => {
  ps.lookup({ pid }, (error, resultList) => {
    if (error) {
      reject(error);
    } else if (resultList.length > 0) {
      resolve(true);
    } else {
      resolve(false);
    }
  });
});

module.exports = async (pid:number, name:string) => {
  let processExists = await checkIfProcessExists(pid);
  const exitPromise = new Promise(async (resolve, reject) => {
    for (let i = 0; i < 40; i += 1) {
      if (!processExists) {
        resolve();
        return;
      }
      await new Promise((r) => setTimeout(r, 500));
      processExists = await checkIfProcessExists(pid);
    }
    logger.error(`Timeout when stopping ${name} process ${pid}`);
    reject(new Error(`FFmpegProcessManager timed out when stopping ${name} process ${pid}`));
  });
  logger.info(`Sending SIGTERM to ${name} process ${pid}`);
  try {
    if (processExists) {
      process.kill(pid, 'SIGTERM');
    }
  } catch (error) {
    logger.error(`Error with SIGTERM signal on ${name} process ${pid}: ${error.message}`);
  }
  const sigkillTimeout = setTimeout(async () => {
    logger.info(`Sending SIGKILL to ${name} process ${pid}`);
    try {
      if (processExists) {
        process.kill(pid, 'SIGKILL');
      }
    } catch (error) {
      logger.error(`Error with SIGKILL signal on ${name} process ${pid}: ${error.message}`);
    }
  }, 10000);
  const sigquitTimeout = setTimeout(async () => {
    logger.info(`Sending SIGQUIT to ${name} process ${pid}`);
    try {
      if (processExists) {
        process.kill(pid, 'SIGQUIT');
      }
    } catch (error) {
      logger.error(`Error with SIGQUIT signal on ${name} process ${pid}: ${error.message}`);
    }
  }, 15000);
  await exitPromise;
  clearTimeout(sigkillTimeout);
  clearTimeout(sigquitTimeout);
  logger.info(`Stopped ${name} process ${pid}`);
};
