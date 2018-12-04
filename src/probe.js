// @flow

const logger = require('./lib/logger')('FFmpeg Process Manager (FFprobe)');
const { spawn } = require('child_process');
const { ffprobePath } = require('ffmpeg-static');
const FFprobeProcessError = require('./lib/ffprobe-process-error');
const killProcess = require('./lib/kill-process');

let pids = new Set();
let isShuttingDown = false;

const shutdown = async () => {
  if (!isShuttingDown) {
    isShuttingDown = true;
    const pidsToKill = [...pids].map((pid) => [pid, 'FFprobe process']);
    await Promise.all(pidsToKill.map(([pid, name]) => killProcess(pid, name)));
    logger.info('Shut down');
    isShuttingDown = false;
    pids = new Set();
  }
};

module.exports.shutdownFFprobe = shutdown;

process.on('exit', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('SIGBREAK', shutdown);
process.on('SIGHUP', shutdown);

module.exports.startFFprobe = async (args:Array<string>):Promise<Array<string>> => {
  const combinedArgs = ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', '-show_error'].concat(args);
  if (combinedArgs.indexOf('-timeout') === -1) {
    combinedArgs.unshift('10');
    combinedArgs.unshift('-timeout');
  }
  const mainProcess = spawn(ffprobePath, combinedArgs, {
    windowsHide: true,
    shell: false,
    detached: false,
  });
  pids.add(mainProcess.pid);
  logger.info(`Started FFprobe process ${mainProcess.pid}`);
  const promise = new Promise((resolve, reject) => {
    const stdout = [];
    let stderr = [];
    mainProcess.stdout.on('data', (data) => {
      stdout.push(data.toString('utf8'));
    });
    mainProcess.stderr.on('data', (data) => {
      const message = data.toString('utf8').trim().split('\n').map((line) => line.trim());
      message.forEach((line) => logger.error(line));
      stderr = stderr.concat(message);
    });
    mainProcess.once('error', async (error) => {
      reject(error);
    });
    mainProcess.once('close', async (code) => {
      let stdoutData;
      try {
        stdoutData = JSON.parse(stdout.join(''));
        JSON.stringify(stdoutData, null, 2).split('\n').forEach((line) => logger.info(line));
      } catch (error) {
        logger.error(error.message);
      }
      if (stdoutData && stdoutData.error && stdoutData.error.code && stdoutData.error.string) {
        reject(new FFprobeProcessError(`FFprobe process ${mainProcess.pid} exited with error code ${code} and internal error code ${stdoutData.error.code}: ${stdoutData.error.string}`, stdoutData.error.code, stderr, stdoutData));
      } else if (code && code !== 255) {
        reject(new FFprobeProcessError(`FFprobe process ${mainProcess.pid} exited with error code ${code}`, code, stderr, stdoutData));
      } else if (stderr.length > 0) {
        reject(new FFprobeProcessError(`FFprobe process ${mainProcess.pid} exited with code ${code} but contained errors`, code, stderr, stdoutData));
      } else if (!stdoutData) {
        reject(new FFprobeProcessError(`FFprobe process ${mainProcess.pid} exited with code ${code} but did not output any data`, code, stderr, stdoutData));
      } else {
        resolve(stdoutData);
      }
    });
  });
  promise.then(() => {
    pids.delete(mainProcess.pid);
  }).catch(() => {
    pids.delete(mainProcess.pid);
  });
  return promise;
};
