// @flow

import type FFmpegProcessManager from '../../src/process-manager';

module.exports.waitForClose = (processManager:FFmpegProcessManager, id:string):Promise<void> => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => {
    reject(new Error('Timeout on close of managed FFmpeg process'));
  }, 30000);
  const handleClose = (closedId:string) => {
    if (closedId === id) {
      clearTimeout(timeout);
      processManager.removeListener('close', handleClose);
      processManager.removeListener('error', reject);
      resolve();
    }
  };
  processManager.on('close', handleClose);
  processManager.once('error', reject);
});

module.exports.waitForStatus = (processManager:FFmpegProcessManager, id:string):Promise<Object> => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => {
    reject(new Error('Timeout on status of managed FFmpeg process'));
  }, 30000);
  const handleStatus = (statusId:string, data:Object) => {
    if (statusId === id) {
      clearTimeout(timeout);
      processManager.removeListener('status', handleStatus);
      processManager.removeListener('error', reject);
      resolve(data);
    }
  };
  processManager.on('status', handleStatus);
  processManager.once('error', reject);
});

module.exports.waitForStdErr = (processManager:FFmpegProcessManager, id:string):Promise<string> => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => {
    reject(new Error('Timeout on stderr of managed FFmpeg process'));
  }, 30000);
  const handleStdErr = (stdErrId:string, message:string) => {
    if (stdErrId === id) {
      clearTimeout(timeout);
      processManager.removeListener('stderr', handleStdErr);
      processManager.removeListener('error', reject);
      resolve(message);
    }
  };
  processManager.on('stderr', handleStdErr);
  processManager.once('error', reject);
});
