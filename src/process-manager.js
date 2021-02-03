// @flow

const colors = require('colors/safe');
const { ffmpegPath } = require('@bunchtogether/ffmpeg-static');
const { spawn } = require('child_process');
const stringify = require('json-stringify-deterministic');
const murmurHash3 = require('murmurhash3js');
const os = require('os');
const EventEmitter = require('events');
const ps = require('ps-node');
const makeLogger = require('./logger');
const mergeAsyncCalls = require('./lib/merge-async-calls');
const killProcess = require('./lib/kill-process');
const pidusage = require('pidusage');
const TemporaryFFmpegProcessError = require('./lib/temporary-ffmpeg-process-error');
const NullCheckFFmpegProcessError = require('./lib/null-check-ffmpeg-process-error');
const { default: PQueue } = require('p-queue');

const logger = makeLogger('FFmpeg Process Manager');

type OptionsType = {
  updateIntervalSeconds?: number,
  useSystemBinary?: boolean,
};

type StartOptionsType = {
  skipInit?: boolean,
  skipRestart?: boolean,
  beforeStart?: () => Promise<void>
};

const getFFmpegPath = (useSystemBinary?: boolean) => {
  if (useSystemBinary) {
    // eslint-disable-next-line global-require
    const { ffmpegSystemPath } = require('@bunchtogether/ffmpeg-static');
    if (!ffmpegSystemPath) {
      throw new Error('ffmpeg binary is either not installed on this system or available globally');
    }
    return ffmpegSystemPath;
  }
  return ffmpegPath;
};

const logFFmpegArgs = (args) => {
  logger.info(colors.grey('  ffmpeg \\'));
  const items = (` ${args.join(' ')}`).split(/\s-(?![0-9]+)/);
  items.forEach((line, index) => {
    if (line.trim().length === 0) {
      return;
    }
    if (index === items.length - 1) {
      logger.info(colors.grey(`   -${line.trim()}`));
    } else {
      logger.info(colors.grey(`   -${line.trim()} \\`));
    }
  });
};

// const frameRegex = /frame=([0-9]+)/;

class FFmpegProcessManager extends EventEmitter {
  ready: void | Promise<void>;
  progress: Map<string, { fps: number, bitrate: number, speed: number }>;
  interval: IntervalID;
  pids: Map<number, string>;
  ids: Map<string, number>;
  keepAlive: Map<string, { attempt: number, args: Array<string>, restartTime: number, beforeStart?: () => Promise<void> }>;
  isShuttingDown: boolean;
  platform: string;
  start: (Array<string>, ?StartOptionsType) => Promise<[string, number]>;
  stop: (string) => Promise<void>;
  stopping: Set<string>;
  updateIntervalSeconds: number;
  useSystemBinary: boolean;
  ffmpegPath:string;
  queue: PQueue;

  constructor(options:OptionsType) {
    super();
    this.isShuttingDown = false;
    this.progress = new Map();
    this.keepAlive = new Map();
    this.updateIntervalSeconds = options.updateIntervalSeconds || 10;
    this.useSystemBinary = options.useSystemBinary || false;
    this.ffmpegPath = getFFmpegPath(this.useSystemBinary);
    this.pids = new Map();
    this.ids = new Map();
    this.stopping = new Set();
    this.platform = os.platform();
    this.queue = new PQueue();
    this.start = mergeAsyncCalls((args: Array < string >, opts ?: StartOptionsType = {}) => this.queue.add(() => this._start(args, opts))); // eslint-disable-line no-underscore-dangle
  }

  init() {
    if (!this.ready) {
      this.ready = (async () => {
        this.isShuttingDown = false;
        await this.stopAll();
        this.interval = setInterval(() => this.updateStatus(), this.updateIntervalSeconds * 1000);
        logger.info('Initialized');
      })();
    }
    return this.ready;
  }

  async stopAll() {
    const stopPromises = [];
    for (const id of this.ids.keys()) {
      stopPromises.push(this.stop(id));
    }
    await Promise.all(stopPromises);
    const processes = await this.getFFmpegProcesses();
    const pidsToKill = [...processes.keys()].map((pid) => [pid, 'FFmpeg process']);
    await Promise.all(pidsToKill.map(async ([pid, name]) => killProcess(pid, name)));
  }

  async shutdown() {
    if (this.isShuttingDown) {
      return;
    }
    this.isShuttingDown = true;
    clearInterval(this.interval);
    await this.queue.onIdle();
    await this.stopAll();
    delete this.ready;
    this.progress = new Map();
    this.keepAlive = new Map();
    this.pids = new Map();
    this.ids = new Map();
    logger.info('Shut down');
    this.isShuttingDown = false;
  }

  async getFFmpegProcesses(): Promise < Map < number, Array < string >>> {
    return new Promise((resolve, reject) => {
      ps.lookup({ command: 'ffmpeg' }, (error, resultList) => {
        if (error) {
          reject(error);
        } else {
          const processes = new Map();
          resultList.forEach((result) => {
            // Remove the "-v quiet -nostats -progress" args
            if (result.arguments && result.arguments.indexOf('begin=1') !== -1) {
              processes.set(parseInt(result.pid, 10), result.arguments.slice(5, -2));
            }
          });
          resolve(processes);
        }
      });
    });
  }

  async updateStatus() {
    if (this.pids.size === 0) {
      return;
    }
    const cpuAndMemoryUsage = await this.getCpuAndMemoryUsage([...this.pids.keys()]);
    for (const [pid, id] of this.pids) {
      const status = Object.assign(
        {
          fps: 0,
          bitrate: 0,
          speed: 0,
          cpu: 0,
          droppedFrames: 0,
          memory: 0,
        },
        cpuAndMemoryUsage.get(pid),
        this.progress.get(id),
      );
      this.emit('status', id, status);
    }
  }

  getId(args: Array<string>) {
    const hashedId = murmurHash3.x64.hash128(stringify(args));
    return `${hashedId.slice(0, 8)}-${hashedId.slice(8, 12)}-${hashedId.slice(12, 16)}-${hashedId.slice(16, 20)}-${hashedId.slice(20)}`;
  }

  restart(id: string) {
    return this.queue.add(() => this._restart(id)); // eslint-disable-line no-underscore-dangle
  }

  async _restart(id: string) {
    if (this.isShuttingDown) {
      logger.warn(`Skipping restart of process with ID ${id}: Shutting down`);
      return;
    }
    if (this.stopping.has(id)) {
      logger.warn(`Skipping restart of process with ID ${id}: Process stop was requested`);
      return;
    }
    const keepAliveData = this.keepAlive.get(id);
    if (!keepAliveData) {
      this.stop(id);
      return;
    }
    const { attempt, args, restartTime, beforeStart } = keepAliveData;
    logger.warn(`Restarting process with ID ${id} after ${Math.round((Date.now() - restartTime) / 100) / 10} seconds of uptime`);
    if (restartTime && (Date.now() - restartTime) > 120000) {
      this.keepAlive.set(id, { attempt: 1, args, restartTime: Date.now(), beforeStart });
    } else {
      this.keepAlive.set(id, { attempt: attempt + 1, args, restartTime: Date.now(), beforeStart });
    }
    if (attempt > 5) {
      await this.stop(id);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000 * attempt * attempt));
    if (this.isShuttingDown) {
      logger.warn(`Skipping restart of process with ID ${id}: Shutting down`);
      return;
    }
    if (this.stopping.has(id)) {
      logger.warn(`Skipping restart of process with ID ${id}: Process stop was requested`);
      return;
    }
    try {
      await this.start(args, { beforeStart });
      logger.warn(`Restarted process with ID ${id}`);
    } catch (error) {
      if (error.stack) {
        logger.error(`Unable to restart process with ID ${id}:`);
        error.stack.split('\n').forEach((line) => logger.error(`\t${line.trim()}`));
      } else {
        logger.error(`Unable to restart process with ID ${id}: ${error.message}`);
      }
      this.stop(id);
    }
  }

  async startTemporary(args: Array < string >, duration:number) {
    await this.init();
    const combinedArgs = ['-v', 'error', '-nostats'].concat(args, ['-metadata', 'temporary=1']);
    const ffmpegProcess = spawn(this.ffmpegPath, combinedArgs, {
      windowsHide: true,
      shell: false,
      detached: false,
    });
    const pid = ffmpegProcess.pid;
    if (typeof pid !== 'number') {
      try {
        ffmpegProcess.kill();
      } catch (error) {
        logger.error(`Unable to kill process with args ${combinedArgs.join(' ')} after failed start`);
        logger.errorStack(error);
      }
      throw new Error(`Did not receive PID when starting process with args ${combinedArgs.join(' ')}`);
    }
    const processLogger = makeLogger(`FFmpeg Process ${pid}`);
    logger.info(`Started FFmpeg temporary process ${pid}`);
    logFFmpegArgs(combinedArgs);
    const stderr = [];
    ffmpegProcess.stderr.on('data', (data) => {
      const message = data.toString('utf8').trim();
      message.split('\n').forEach((line) => processLogger.error(line.trim()));
      stderr.push(message);
    });
    ffmpegProcess.once('error', (error) => {
      logger.error(error.message);
    });
    const timeout = setTimeout(() => {
      killProcess(pid, 'temporary FFmpeg process');
    }, duration);
    await new Promise((resolve, reject) => {
      ffmpegProcess.once('close', (code) => {
        clearTimeout(timeout);
        if (code && code !== 255) {
          reject(new TemporaryFFmpegProcessError(`Temporary FFmpeg process ${ffmpegProcess.pid} exited with error code ${code}`, code, stderr));
        } else {
          resolve();
        }
      });
    });
  }

  async startNullCheck(args: Array < string >) {
    await this.init();
    const combinedArgs = ['-v', 'error', '-nostats'].concat(args, ['-metadata', 'temporary=1', '-f', 'null', '-']);
    const ffmpegProcess = spawn(this.ffmpegPath, combinedArgs, {
      windowsHide: true,
      shell: false,
      detached: false,
    });
    const pid = ffmpegProcess.pid;
    if (typeof pid !== 'number') {
      try {
        ffmpegProcess.kill();
      } catch (error) {
        logger.error(`Unable to kill process with args ${combinedArgs.join(' ')} after failed start`);
        logger.errorStack(error);
      }
      throw new Error(`Did not receive PID when starting process with args ${combinedArgs.join(' ')}`);
    }
    const timeout = setTimeout(() => {
      killProcess(ffmpegProcess.pid, 'null check FFmpeg process');
    }, 5000);
    const processLogger = makeLogger(`FFmpeg Process ${pid}`);
    logger.info(`Started FFmpeg null check process ${pid}`);
    logFFmpegArgs(combinedArgs);
    const stderr = [];
    let initialChange = true;
    ffmpegProcess.stdout.on('data', () => {
      if (initialChange) {
        initialChange = false;
        return;
      }
      killProcess(pid, 'null check FFmpeg process');
    });
    ffmpegProcess.stderr.on('data', (data) => {
      const message = data.toString('utf8').trim();
      message.split('\n').forEach((line) => processLogger.error(line.trim()));
      stderr.push(message);
    });
    ffmpegProcess.once('error', (error) => {
      logger.error(error.message);
    });
    await new Promise((resolve, reject) => {
      ffmpegProcess.once('close', (code) => {
        clearTimeout(timeout);
        if (code && code !== 255) {
          reject(new NullCheckFFmpegProcessError(`Null check FFmpeg process ${ffmpegProcess.pid} exited with error code ${code}`, code, stderr));
        } else {
          resolve();
        }
      });
    });
  }

  async _start(args: Array < string >, options ?: StartOptionsType = {}) {
    if (!options.skipInit) {
      await this.init();
    }
    const id = this.getId(args);
    const managedPid = this.ids.get(id);
    if (managedPid) {
      return [id, managedPid];
    }
    if (this.stopping.has(id)) {
      logger.error(`FFmpeg process with ID ${id} is being stopped`);
      throw new Error(`FFmpeg process with ID ${id} is being stopped`);
    }
    if (!options.skipRestart) {
      this.keepAlive.set(id, this.keepAlive.get(id) || { attempt: 0, args, restartTime: Date.now(), beforeStart: options.beforeStart });
    }
    if (options.beforeStart) {
      await options.beforeStart();
    }
    const combinedArgs = ['-v', 'error', '-nostats', '-progress', 'pipe:1'].concat(args, ['-metadata', 'begin=1']);
    const ffmpegProcess = spawn(this.ffmpegPath, combinedArgs, {
      windowsHide: true,
      shell: false,
      detached: false,
    });
    const pid = ffmpegProcess.pid;
    if (typeof pid !== 'number') {
      try {
        ffmpegProcess.kill();
      } catch (error) {
        logger.error(`Unable to kill process with args ${combinedArgs.join(' ')} after failed start`);
        logger.errorStack(error);
      }
      throw new Error(`Did not receive PID when starting process with args ${combinedArgs.join(' ')}`);
    }
    if (this.ids.get(id)) {
      await killProcess(pid, 'FFmpeg');
      throw new Error(`Conflicting ID ${id} for FFmpeg process ${pid}`);
    }
    this.pids.set(pid, id);
    this.ids.set(id, pid);
    ffmpegProcess.once('error', (error) => {
      logger.error(error.message);
    });
    // let timeout;
    ffmpegProcess.once('close', (code) => {
      if (code && code !== 255) {
        logger.error(`FFmpeg process ${ffmpegProcess.pid} with ID ${id} exited with error code ${code}`);
      }
      this.pids.delete(pid);
      this.ids.delete(id);
      this.emit('close', id);
      this.restart(id);
    });
    const processLogger = makeLogger(`FFmpeg Process ${pid}`);
    logger.info(`Started FFmpeg process ${ffmpegProcess.pid} with ID ${id}`);
    logFFmpegArgs(combinedArgs);
    ffmpegProcess.stderr.on('data', (data) => {
      const message = data.toString('utf8').trim();
      message.split('\n').forEach((line) => processLogger.error(line.trim()));
      this.emit('stderr', id, message);
    });
    let previousData = {
      frame: 0,
      fps: 0,
      stream_0_0_q: 0,
      bitrate: 0,
      total_size: 0,
      out_time_us: 0,
      out_time_ms: 0,
      out_time: 0,
      dup_frames: 0,
      drop_frames: 0,
      speed: 0,
      progress: NaN,
    };
    ffmpegProcess.stdout.on('data', (buffer:Buffer) => {
      const data = {};
      buffer.toString('utf-8').trim().split('\n').forEach((line) => {
        const [key, value] = line.split('=');
        if (key && value) {
          data[key.trim()] = parseFloat(value.replace(/[^0-9.]/g, ''));
        }
      });
      const progress = {
        droppedFrames: (isNaN(data.frame) || isNaN(previousData.frame) || isNaN(data.drop_frames) || isNaN(previousData.drop_frames) || data.frame - previousData.frame === 0) ? 1 : (data.drop_frames - previousData.drop_frames) / (data.frame - previousData.frame),
        fps: isNaN(data.fps) ? 0 : data.fps,
        bitrate: isNaN(data.bitrate) ? 0 : data.bitrate,
        speed: isNaN(data.speed) ? 0 : data.speed,
      };
      previousData = data;
      this.emit('progress', id, progress);
      this.progress.set(id, progress);
    });
    return [id, pid];
  }

  async stop(id: string) {
    this.stopping.add(id);
    await this.queue.onIdle();
    try {
      this.keepAlive.delete(id);
      const processesBeforeClose = await this.getFFmpegProcesses();
      const pids = new Set();
      const mainPid = this.ids.get(id);
      if (mainPid) {
        pids.add(mainPid);
      }
      for (const [ffmpegProcessId, ffmpegArgs] of processesBeforeClose) {
        if (id === this.getId(ffmpegArgs)) {
          pids.add(ffmpegProcessId);
        }
      }
      await Promise.all([...pids].map((pid) => killProcess(pid, 'FFmpeg')));
    } catch (error) {
      if (error.stack) {
        logger.error(`Unable to stop FFmpeg processes with ID ${id}:`);
        error.stack.split('\n').forEach((line) => logger.error(`\t${line.trim()}`));
      } else {
        logger.error(`Unable to stop FFmpeg processes with ID ${id}`);
      }
    }
    await this.queue.onIdle();
    this.stopping.delete(id);
  }

  getCpuAndMemoryUsage(pids: Array<number>): Promise < Map < number, { cpu: number, memory: number } >> {
    if (pids.length === 0) {
      return Promise.resolve(new Map());
    }
    return new Promise((resolve, reject) => {
      const usage = new Map();
      pidusage(pids, (error, stats) => {
        if (error) {
          if (error.message === 'No maching pid found') {
            logger.warn(`Matching PID was not found on CPU and memory usage lookup for ${pids.toString()}`);
            resolve(usage);
          } else {
            reject(error);
          }
        } else {
          Object.keys(stats).forEach((pid) => {
            const s = stats[pid];
            if (!s) {
              logger.warn(`Unable to get memory usage for process ${pid}, pidusage returned: ${JSON.stringify(stats)}`);
              return;
            }
            usage.set(parseInt(pid, 10), { cpu: s.cpu, memory: s.memory });
          });
          resolve(usage);
        }
      });
    });
  }
}

module.exports = FFmpegProcessManager;
