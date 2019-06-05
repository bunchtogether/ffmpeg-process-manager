// @flow

const terminate = require('terminate');
const logger = require('./logger')('FFmpeg Process Manager');

module.exports = async (pid:number, name:string) => {
  try {
    logger.info(`Sending SIGTERM to ${name} process ${pid}`);
    await new Promise((resolve, reject) => {
      terminate(pid, 'SIGTERM', (error) => {
        if (error && error.code === 'ESRCH') {
          resolve();
        } else if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
    logger.info(`Stopped ${name} process ${pid} with SIGTERM`);
    return;
  } catch (error) {
    console.log(error.code, error.status);
    logger.error(`Error with SIGTERM signal on ${name} process ${pid}: ${error.message}`);
  }
  try {
    logger.info(`Sending SIGKILL to ${name} process ${pid}`);
    await new Promise((resolve, reject) => {
      terminate(pid, 'SIGKILL', (error) => {
        if (error && error.code === 'ESRCH') {
          resolve();
        } else if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
    logger.info(`Stopped ${name} process ${pid} with SIGKILL`);
    return;
  } catch (error) {
    logger.error(`Error with SIGKILL signal on ${name} process ${pid}: ${error.message}`);
  }
  try {
    logger.info(`Sending SIGQUIT to ${name} process ${pid}`);
    await new Promise((resolve, reject) => {
      terminate(pid, 'SIGQUIT', (error) => {
        if (error && error.code === 'ESRCH') {
          resolve();
        } else if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
    logger.info(`Stopped ${name} process ${pid} with SIGQUIT`);
    return;
  } catch (error) {
    console.log(error.code, error.status);
    logger.error(`Error with SIGQUIT signal on ${name} process ${pid}: ${error.message}`);
  }
  throw new Error(`FFmpegProcessManager timed out when stopping ${name} process ${pid}`);
};
