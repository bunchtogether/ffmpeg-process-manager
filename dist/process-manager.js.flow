// @flow

const { ffmpegPath } = require('@bunchtogether/ffmpeg-static');
const { spawn } = require('child_process');
const stringify = require('json-stringify-deterministic');
const murmurHash3 = require('murmurhash3js');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const EventEmitter = require('events');
const { addShutdownHandler } = require('@bunchtogether/exit-handler');
const ps = require('ps-node');
const logger = require('./lib/logger')('FFmpeg Process Manager');
const pidusage = require('pidusage');
const mergeAsyncCalls = require('./lib/merge-async-calls');
const TemporaryFFmpegProcessError = require('./lib/temporary-ffmpeg-process-error');
const NullCheckFFmpegProcessError = require('./lib/null-check-ffmpeg-process-error');
const killProcess = require('./lib/kill-process');

type OptionsType = {
  updateIntervalSeconds?: number,
  useSystemBinary?: boolean,
};

type StartOptionsType = {
  skipInit?: boolean,
  skipRestart?: boolean
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

class FFmpegProcessManager extends EventEmitter {
  ready: Promise<void> | void;
  outputPath: string;
  progress: Map<string, { fps: number, bitrate: number, speed: number }>;
  interval: IntervalID;
  updateIntervalSeconds: number;
  useSystemBinary: boolean;
  ffmpegPath: string;
  pids: Map<number, string>;
  ids: Map<string, number>;
  tempPids: Set<number>;
  keepAlive: Map<string, { attempt: number, args: Array<string>, stop?:boolean }>;
  isShuttingDown: boolean;
  platform: string;
  closeHandlers: Map<string, Array<() => Promise<void> | void>>;
  shutdownHandlers: Map<string, () => Promise<void> | void>;
  start: (Array<string>, ?StartOptionsType) => Promise<[string, number]>;
  restartingProcesses:Set<string>;

  constructor(options ?: OptionsType = {}) {
    super();
    this.isShuttingDown = false;
    this.outputPath = path.resolve(path.join(os.tmpdir(), 'node-ffmpeg-process-manager'));
    this.progress = new Map();
    this.keepAlive = new Map();
    this.updateIntervalSeconds = options.updateIntervalSeconds || 10;
    this.useSystemBinary = options.useSystemBinary || false;
    this.ffmpegPath = getFFmpegPath(this.useSystemBinary);
    this.pids = new Map();
    this.ids = new Map();
    this.tempPids = new Set();
    this.platform = os.platform();
    this.closeHandlers = new Map();
    this.shutdownHandlers = new Map();
    this.restartingProcesses = new Set();
    this.start = mergeAsyncCalls(this._start.bind(this)); // eslint-disable-line  no-underscore-dangle
    addShutdownHandler(this.shutdown.bind(this), (error: Error) => {
      logger.error('Error during shutdown:');
      logger.errorStack(error);
    });
  }

  init() {
    if (!this.ready) {
      this.ready = (async () => {
        this.isShuttingDown = false;
        try {
          await fs.ensureDir(this.outputPath);
          await this.cleanupProcesses();
          this.interval = setInterval(() => this.updateStatus(), this.updateIntervalSeconds * 1000);
          const processes = await this.getFFmpegProcesses();
          for (const [pid, args] of processes) {
            logger.warn(`Found FFmpeg process ${pid} on init, starting with [${args.join(', ')}]`);
            await this.start(args, { skipInit: true });
          }
        } catch (error) {
          if (error.stack) {
            logger.error('Unable to start ffmpeg-process-manager:');
            error.stack.split('\n').forEach((line) => logger.error(`\t${line.trim()}`));
          } else {
            logger.error(`Unable to start ffmpeg-process-manager: ${error.message}`);
          }
          await new Promise((resolve) => setTimeout(resolve, 1000));
          process.exit(1);
        }
        logger.info('Initialized');
      })();
    }
    return this.ready;
  }

  async cleanupProcesses() {
    const processes = await this.getFFmpegProcesses();
    const map = new Map();
    for (const [pid, args] of processes) {
      const id = this.getId(args);
      map.set(id, pid);
    }
    for (const [pid, args] of processes) {
      const id = this.getId(args);
      if (map.get(id) !== pid) {
        await killProcess(pid, `redundant FFmpeg process ${id}`);
      }
    }
  }

  async stopAll() {
    for (const id of this.ids.keys()) {
      try {
        await this.stop(id);
      } catch (error) {
        logger.error(`Unable to stop FFmpeg process ${id}`);
        logger.errorStack(error);
      }
    }
  }

  async shutdown() {
    if (this.isShuttingDown) {
      return;
    }
    for (const [id, shutdownHandler] of this.shutdownHandlers) {
      try {
        await shutdownHandler();
      } catch (error) {
        logger.error(`Unable to run shutdown handler for FFmpeg process ${id}`);
        logger.errorStack(error);
      }
    }
    this.isShuttingDown = true;
    clearInterval(this.interval);
    const pidsToKill = [...this.tempPids].map((pid) => [pid, 'temporary FFmpeg process']);
    await Promise.all(pidsToKill.map(([pid, name]) => killProcess(pid, name)));
    logger.info('Shut down');
    delete this.ready;
    this.progress = new Map();
    this.keepAlive = new Map();
    this.pids = new Map();
    this.ids = new Map();
    this.tempPids = new Set();
    this.closeHandlers = new Map();
  }

  async updateStatus() {
    if (this.pids.size === 0) {
      return;
    }
    const processes = await this.getFFmpegProcesses();
    for (const [pid, id] of this.pids) {
      if (!processes.has(pid)) {
        logger.warn(`Process ${pid} with ID ${id} closed`);
        await this.cleanupJob(id);
      }
    }
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

  getFFmpegProcesses(): Promise < Map < number, Array < string >>> {
    return new Promise((resolve, reject) => {
      ps.lookup({ command: this.ffmpegPath }, (error, resultList) => {
        if (error) {
          reject(error);
        } else {
          const processes = new Map();
          resultList.forEach((result) => {
          // Remove the "-v quiet -nostats -progress" args
            if (result.arguments && result.arguments.indexOf('temporary_process="1"') === -1) {
              processes.set(parseInt(result.pid, 10), result.arguments.slice(5));
            }
          });
          resolve(processes);
        }
      });
    });
  }

  async cleanupJob(id: string) {
    const pid = this.ids.get(id);
    if (!pid) {
      return;
    }
    this.pids.delete(pid);
    this.ids.delete(id);
    await this.runCloseHandlers(id);
  }

  getId(args: Array<string>) {
    const hashedId = murmurHash3.x64.hash128(stringify(args));
    return `${hashedId.slice(0, 8)}-${hashedId.slice(8, 12)}-${hashedId.slice(12, 16)}-${hashedId.slice(16, 20)}-${hashedId.slice(20)}`;
  }

  async restart(id: string) {
    const keepAliveData = this.keepAlive.get(id);
    if (!keepAliveData) {
      return;
    }
    if (keepAliveData.stop) {
      this.keepAlive.delete(id);
      return;
    }
    if (this.restartingProcesses.has(id)) {
      return;
    }
    this.restartingProcesses.add(id);
    const { attempt, args } = keepAliveData;
    logger.warn(`Restarting process with ID ${id}, attempt ${attempt}`);
    this.keepAlive.set(id, { attempt: attempt + 1, args });
    if (attempt > 100) {
      logger.warn(`Skipping restart of process with ID ${id} after 100 attempts`);
      this.restartingProcesses.delete(id);
      this.keepAlive.delete(id);
      return;
    } else if (attempt < 10) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt * attempt));
    } else {
      await new Promise((resolve) => setTimeout(resolve, 1000 * 100));
    }
    this.restartingProcesses.delete(id);
    if (keepAliveData.stop) {
      this.keepAlive.delete(id);
      return;
    }
    await this.start(args);
    logger.warn(`Restarted process with ID ${id}`);
  }

  async startNullCheck(args: Array<string>): Promise < void> {
    const duration = 5000;
    const combinedArgs = ['-v', 'error', '-nostats', '-progress', 'pipe:1'].concat(args, ['-metadata', 'temporary_process="1"', '-f', 'null', '-']);
    const mainProcess = spawn(this.ffmpegPath, combinedArgs, {
      windowsHide: true,
      shell: false,
      detached: false,
    });
    this.tempPids.add(mainProcess.pid);
    logger.info(`Started null check FFmpeg process ${mainProcess.pid} for ${duration}ms`);
    return new Promise((resolve, reject) => {
      let stderr = [];
      const timeout = setTimeout(() => {
        killProcess(mainProcess.pid, 'null check FFmpeg process');
      }, duration);
      let initialChange = true;
      mainProcess.stdout.on('data', () => {
        if (initialChange) {
          initialChange = false;
          return;
        }
        killProcess(mainProcess.pid, 'null check FFmpeg process');
      });
      mainProcess.stderr.on('data', (data) => {
        const message = data.toString('utf8').trim().split('\n').map((line) => line.trim());
        message.forEach((line) => logger.error(`\t${line.trim()}`));
        stderr = stderr.concat(message);
      });
      mainProcess.once('error', async (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      mainProcess.once('close', async (code) => {
        clearTimeout(timeout);
        this.tempPids.delete(mainProcess.pid);
        if (code && code !== 255) {
          const message = `Null check FFmpeg process ${mainProcess.pid} exited with error code ${code}`;
          logger.error(message);
          logger.error(`\tArguments: ${args.join(' ')}`);
          reject(new NullCheckFFmpegProcessError(message, code, stderr));
        } else if (stderr.length > 0) {
          const message = `Null check FFmpeg process ${mainProcess.pid} exited with error code ${code} but contained errors`;
          logger.error(message);
          logger.error(`\tArguments: ${args.join(' ')}`);
          reject(new NullCheckFFmpegProcessError(message, code, stderr));
        } else {
          resolve();
        }
      });
    });
  }

  async startTemporary(args: Array < string >, duration: number): Promise < void> {
    const combinedArgs = ['-v', 'error', '-nostats'].concat(args, ['-metadata', 'temporary_process="1"']);
    const mainProcess = spawn(this.ffmpegPath, combinedArgs, {
      windowsHide: true,
      shell: false,
      detached: false,
    });
    this.tempPids.add(mainProcess.pid);
    logger.info(`Started temporary FFmpeg process ${mainProcess.pid} for ${duration}ms`);
    const promise = new Promise((resolve, reject) => {
      let stderr = [];
      const timeout = setTimeout(() => {
        killProcess(mainProcess.pid, 'temporary FFmpeg process');
      }, duration);
      mainProcess.stderr.on('data', (data) => {
        const message = data.toString('utf8').trim().split('\n').map((line) => line.trim());
        message.forEach((line) => logger.error(`\t${line.trim()}`));
        stderr = stderr.concat(message);
      });
      mainProcess.once('error', async (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      mainProcess.once('close', async (code) => {
        clearTimeout(timeout);
        if (code && code !== 255) {
          const message = `Temporary FFmpeg process ${mainProcess.pid} exited with error code ${code}`;
          logger.error(message);
          logger.error(`\tArguments: ${args.join(' ')}`);
          reject(new TemporaryFFmpegProcessError(message, code, stderr));
        } else if (stderr.length > 0) {
          const message = `Temporary FFmpeg process ${mainProcess.pid} exited with error code ${code} but contained errors`;
          logger.error(message);
          logger.error(`\tArguments: ${args.join(' ')}`);
          reject(new TemporaryFFmpegProcessError(message, code, stderr));
        } else {
          resolve();
        }
      });
    });
    promise.then(() => {
      this.tempPids.delete(mainProcess.pid);
    }).catch(() => {
      this.tempPids.delete(mainProcess.pid);
    });
    return promise;
  }

  async _start(args: Array < string >, options ?: StartOptionsType = {}) {
    if (!options.skipInit) {
      await this.init();
    }
    const id = this.getId(args);
    const managedPid = this.ids.get(id);
    if (managedPid) {
      logger.debug(`FFmpeg process ${managedPid} with ID ${id} is already running, skipping start`);
      return [id, managedPid];
    }
    const outputPath = args[args.length - 1];
    if (outputPath.indexOf('/') !== -1) {
      const outputDirectory = outputPath.split('/').slice(0, -1).join('/');
      const exists = await fs.exists(outputDirectory);
      if (!exists) {
        logger.info(`Creating output directory ${outputDirectory}`);
        await fs.ensureDir(outputDirectory);
      }
    }
    const processes = await this.getFFmpegProcesses();
    const stringifiedArgs = stringify(args);
    let keepAliveData = this.keepAlive.get(id);
    if (keepAliveData) {
      keepAliveData.stop = true;
      this.keepAlive.set(id, keepAliveData);
    }
    for (const [ffmpegProcessId, ffmpegArgs] of processes) {
      if (stringify(ffmpegArgs) === stringifiedArgs) {
        await killProcess(ffmpegProcessId, `pre-existing FFmpeg ${id}`);
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
    if (!options.skipRestart) {
      keepAliveData = this.keepAlive.get(id) || { attempt: 0, args, stop: false };
      keepAliveData.stop = false;
      this.keepAlive.set(id, keepAliveData);
    }
    const combinedArgs = ['-v', 'error', '-nostats', '-progress', 'pipe:1'].concat(args);
    const mainProcess = spawn(this.ffmpegPath, combinedArgs, {
      windowsHide: true,
      shell: false,
      detached: true,
    });
    mainProcess.once('close', async (code) => {
      if (code && code !== 255) {
        logger.error(`FFmpeg process ${mainProcess.pid} with ID ${id} exited with error code ${code}`);
      }
    });
    logger.info(`Started FFmpeg process ${mainProcess.pid} with ID ${id}`);
    const pid = mainProcess.pid;
    if (typeof pid !== 'number') {
      try {
        mainProcess.kill();
      } catch (error) {
        logger.error(`Unable to kill process ${id} with args ${args.join(' ')} after failed start`);
        logger.errorStack(error);
      }
      logger.error(`Did not receive PID when starting process ${id} with args ${args.join(' ')}`);
      process.exit(1);
      throw new Error(`Did not receive PID when starting process ${id} with args ${args.join(' ')}`);
    }
    this.pids.set(pid, id);
    this.ids.set(id, pid);
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
    const handleStdout = (buffer:Buffer) => {
      const data = {};
      buffer.toString('utf-8').trim().split('\n').forEach((line) => {
        const [key, value] = line.split('=');
        if (key && value) {
          data[key.trim()] = parseInt(value.replace(/[^0-9.]/g, ''), 10);
        }
      });
      const progress = {
        droppedFrames: (isNaN(data.frame) || isNaN(previousData.frame) || isNaN(data.drop_frames) || isNaN(previousData.drop_frames)) ? 1 : (data.drop_frames - previousData.drop_frames) / (data.frame - previousData.frame),
        fps: isNaN(data.fps) ? 0 : data.fps,
        bitrate: isNaN(data.bitrate) ? 0 : data.bitrate,
        speed: isNaN(data.speed) ? 0 : data.speed,
      };
      previousData = data;
      this.emit('progress', id, progress);
      this.progress.set(id, progress);
    };
    const handleStderr = (buffer:Buffer) => {
      const output = buffer.toString('utf-8').trim();
      logger.error(`FFmpeg process ${pid} with ID ${id}:`);
      output.split('\n').forEach((line) => logger.error(`\t${line.trim()}`));
      this.emit('stderr', id, output);
    };
    mainProcess.stderr.on('data', handleStderr);
    mainProcess.stdout.on('data', handleStdout);
    const shutdownHandler = async () => {
      try {
        mainProcess.stderr.removeListener('data', handleStderr);
        mainProcess.stdout.removeListener('data', handleStdout);
        this.removeListener('close', closeHandler);
      } catch (error) {
        logger.error(`Unable to run shutdown handler for FFmpeg process ${pid} with ID ${id}`);
        logger.errorStack(error);
      }
    };
    this.shutdownHandlers.set(id, shutdownHandler);
    const closeHandler = async () => {
      this.shutdownHandlers.delete(id);
      try {
        mainProcess.stderr.removeListener('data', handleStderr);
        mainProcess.stdout.removeListener('data', handleStdout);
        this.removeListener('close', closeHandler);
        this.restart(id);
      } catch (error) {
        if (error.stack) {
          logger.error(`Unable to close FFmpeg process ${pid} with ID ${id}:`);
          error.stack.split('\n').forEach((line) => logger.error(`\t${line.trim()}`));
        } else {
          logger.error(`Unable to close FFmpeg process ${pid} with ID ${id}:' ${error.message}`);
        }
      }
    };
    this.addCloseHandler(id, closeHandler);
    return [id, pid];
  }

  async runCloseHandlers(id: string) {
    const handlers = this.closeHandlers.get(id);
    if (!handlers) {
      return;
    }
    for (const handler of handlers) {
      await handler();
    }
    this.closeHandlers.delete(id);
    this.emit('close', id);
  }

  addCloseHandler(id: string, handler: () => Promise<void> | void) {
    const handlers = this.closeHandlers.get(id) || [];
    handlers.push(handler);
    this.closeHandlers.set(id, handlers);
  }

  async stop(id: string) {
    const keepAliveData = this.keepAlive.get(id);
    if (keepAliveData) {
      keepAliveData.stop = true;
      this.keepAlive.set(id, keepAliveData);
    }
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
    await this.cleanupJob(id);
  }
}

module.exports = FFmpegProcessManager;
