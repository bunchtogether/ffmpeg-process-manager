// @flow

const logger = require('./lib/logger')('FFmpeg Process Manager (FFprobe)');
const { spawn } = require('child_process');
const { addShutdownHandler } = require('@bunchtogether/exit-handler');
const { ffprobePath } = require('@bunchtogether/ffmpeg-static');
const FFprobeProcessError = require('./lib/ffprobe-process-error');
const killProcess = require('./lib/kill-process');

let pids = new Set();

const shutdown = async () => {
  const pidsToKill = [...pids].map((pid) => [pid, 'FFprobe process']);
  await Promise.all(pidsToKill.map(([pid, name]) => killProcess(pid, name)));
  logger.info('Shut down');
  pids = new Set();
};

addShutdownHandler(shutdown, (error: Error) => {
  if (error.stack) {
    logger.error('Error during shutdown:');
    error.stack.split('\n').forEach((line) => logger.error(`\t${line.trim()}`));
  } else {
    logger.error(`Error during shutdown: ${error.message}`);
  }
});

module.exports.shutdownFFprobe = shutdown;

const getFFprobePath = (useSystemBinary?: boolean) => {
  if (useSystemBinary) {
    // eslint-disable-next-line global-require
    const { ffprobeSystemPath } = require('@bunchtogether/ffmpeg-static');
    if (!ffprobeSystemPath) {
      throw new Error('ffprobe binary is either not installed on this system or available globally');
    }
    return ffprobeSystemPath;
  }
  return ffprobePath;
};

module.exports.startFFprobe = async (args: Array<string>, useSystemBinary?: boolean = false): Promise<Object> => {
  const combinedArgs = ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', '-show_error'].concat(args);
  const captureCardRegexList = ['/dev/video', 'hw:'];
  const isCaptureCardPath = !!captureCardRegexList.find((rx) => {
    const result = args.filter((arg) => arg.includes(rx));
    return result.length > 0;
  });
  if (args.indexOf('-timeout') === -1 && args.indexOf('lavfi') === -1 && !isCaptureCardPath) {
    combinedArgs.unshift('10');
    combinedArgs.unshift('-timeout');
  }
  const ffprobeBinaryPath = getFFprobePath(useSystemBinary);
  const mainProcess = spawn(ffprobeBinaryPath, combinedArgs, {
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
      } catch (error) {
        logger.error(error.message);
      }
      if (stdoutData && stdoutData.error && stdoutData.error.code && stdoutData.error.string) {
        const message = `FFprobe process ${mainProcess.pid} exited with error code ${code} and internal error code ${stdoutData.error.code}: ${stdoutData.error.string}`;
        logger.error(message);
        logger.error(`\tArguments: ${args.join(' ')}`);
        reject(new FFprobeProcessError(message, stdoutData.error.code, stderr, stdoutData));
      } else if (stderr.length > 0) {
        const message = `FFprobe process ${mainProcess.pid} exited with code ${code} but contained errors`;
        logger.error(message);
        logger.error(`\tArguments: ${args.join(' ')}`);
        reject(new FFprobeProcessError(message, code, stderr, stdoutData));
      } else if (code && code !== 255) {
        const message = `FFprobe process ${mainProcess.pid} exited with error code ${code}`;
        logger.error(message);
        logger.error(`\tArguments: ${args.join(' ')}`);
        reject(new FFprobeProcessError(message, code, stderr, stdoutData));
      } else if (!stdoutData) {
        const message = `FFprobe process ${mainProcess.pid} exited with code ${code} but did not output any data`;
        logger.error(message);
        logger.error(`\tArguments: ${args.join(' ')}`);
        reject(new FFprobeProcessError(message, code, stderr, stdoutData));
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
