// @flow

const ffmpegPath = require('ffmpeg-static').path;
const { spawn } = require('child_process');
const stringify = require('json-stringify-deterministic');
const farmhash = require('farmhash');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const EventEmitter = require('events');
const ps = require('ps-node');
const logger = require('./logger')('FFmpeg Process Manager');
const pidusage = require('pidusage');

type OptionsType = {
  updateIntervalSeconds?: number
};


class FFMpegProcessManager extends EventEmitter {
  ready: Promise<void>;
  outputPath: string;
  networkUsageProcess: child_process$ChildProcess; // eslint-disable-line camelcase
  networkUsage: Map<number, {bitrateIn: number, bitrateOut: number}>;
  progress: Map<string, {fps: number, bitrate: number, speed: number}>;
  interval: IntervalID;
  updateIntervalSeconds: number;
  pids: Map<number, string>;
  isShuttingDown: boolean;

  constructor(options?:OptionsType = {}) {
    super();
    this.outputPath = path.resolve(path.join(os.tmpdir(), 'node-ffmpeg-process-manager'));
    this.networkUsage = new Map();
    this.progress = new Map();
    this.updateIntervalSeconds = options.updateIntervalSeconds || 10;
    this.pids = new Map();
    this.isShuttingDown = false;
    const shutdown = this.shutdown.bind(this);
    process.on('EXIT', shutdown);
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
    process.on('SIGBREAK', shutdown);
    process.on('SIGHUP', shutdown);
  }

  init() {
    if (!this.ready) {
      this.ready = (async () => {
        await fs.ensureDir(this.outputPath);
        await this.monitorProcessNetworkUsage();
        this.interval = setInterval(() => this.updateStatus(), this.updateIntervalSeconds * 1000);
        const processes = await this.getFFMpegProcesses();
        for (const args of processes.values()) {
          await this.start(args);
        }
      })();
    }
    return this.ready;
  }

  async shutdown() {
    if (!this.isShuttingDown) {
      this.isShuttingDown = true;
      clearInterval(this.interval);
      if (this.networkUsageProcess) {
        await this.killProcess(this.networkUsageProcess.pid);
      }
      logger.info('Shut down');
    }
  }

  async updateStatus() {
    if (this.pids.size === 0) {
      return;
    }
    const processes = await this.getFFMpegProcesses();
    for (const [pid, id] of this.pids) {
      if (!processes.has(pid)) {
        logger.warn(`Process ${pid} with ID ${id} was not found, emitting "close" event`);
        this.pids.delete(pid);
        this.emit('close', id);
      }
    }
    for (const [pid, args] of processes) {
      if (!this.pids.has(pid)) {
        await this.start(args);
      }
    }
    if (this.pids.size === 0) {
      return;
    }
    const cpuAndMemoryUsage = await this.getCpuAndMemoryUsage([...this.pids.keys()]);
    for (const [pid, id] of this.pids) {
      const status = Object.assign(
        {
          bitrateIn: 0,
          bitrateOut: 0,
          fps: 0,
          bitrate: 0,
          speed: 0,
          cpu: 0,
          memory: 0,
        },
        cpuAndMemoryUsage.get(pid),
        this.progress.get(id),
        this.networkUsage.get(pid),
      );
      this.emit('status', id, status);
    }
  }

  getCpuAndMemoryUsage(pids:Array<number>):Promise<Map<number, {cpu: number, memory: number}>> {
    if (pids.length === 0) {
      return Promise.resolve(new Map());
    }
    return new Promise((resolve, reject) => {
      pidusage(pids, (error, stats) => {
        if (error) {
          if (error.message === 'No maching pid found') {
            logger.warn(`Matching PID was not found on CPU and memory usage lookup for ${pids.toString()}`);
            resolve(new Map());
          } else {
            reject(error);
          }
        } else {
          const usage = new Map();
          Object.keys(stats).forEach((pid) => {
            const s = stats[pid];
            usage.set(parseInt(pid, 10), { cpu: s.cpu, memory: s.memory });
          });
          resolve(usage);
        }
      });
    });
  }

  getFFMpegProcesses():Promise<Map<number, Array<string>>> {
    return new Promise((resolve, reject) => {
      ps.lookup({ command: ffmpegPath }, (error, resultList) => {
        if (error) {
          reject(error);
        } else {
          const processes = new Map();
          resultList.forEach((result) => {
            // Remove the "-v quiet -nostats -progress" args
            processes.set(parseInt(result.pid, 10), result.arguments.slice(5));
          });
          resolve(processes);
        }
      });
    });
  }

  monitorProcessNetworkUsage():Promise<void> {
    const networkUsageProcess = spawn('unbuffer', ['nettop', '-s', this.updateIntervalSeconds.toString(), '-L', '0', '-P', '-d', '-x', '-J', 'bytes_in,bytes_out', '-t', 'external'], {
      windowsHide: true,
      shell: true,
    });
    let lastUpdate = Date.now();
    networkUsageProcess.stdout.on('data', (data) => {
      const networkUsage = new Map();
      const now = Date.now();
      const delta = now - lastUpdate;
      lastUpdate = now;
      data.toString('utf8').trim().split('\n').forEach((row) => {
        const columns = row.split(',');
        if (columns.length < 3) {
          return;
        }
        const pid = columns[0].split('.').pop();
        if (!pid) {
          return;
        }
        const bitrateIn = Math.round(1000 * 8 * parseInt(columns[1], 10) / delta);
        const bitrateOut = Math.round(1000 * 8 * parseInt(columns[2], 10) / delta);
        networkUsage.set(parseInt(pid, 10), { bitrateIn, bitrateOut });
      });
      this.networkUsage = networkUsage;
      this.emit('networkUsage', networkUsage);
    });
    networkUsageProcess.stderr.on('data', (data) => {
      data.toString('utf8').trim().split('\n').forEach((line) => logger.error(line.trim()));
    });
    networkUsageProcess.once('error', async (error) => {
      logger.error(error.message);
    });
    networkUsageProcess.once('close', async (code) => {
      if (code && code !== 0) {
        logger.error(`Network usage process monitor exited with error code ${code}`);
      }
    });
    this.networkUsageProcess = networkUsageProcess;
    return new Promise((resolve) => this.once('networkUsage', resolve));
  }

  checkIfProcessExists(pid:number): Promise<boolean> {
    return new Promise((resolve, reject) => {
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
  }

  async killProcess(pid:number) {
    const exitPromise = new Promise(async (resolve, reject) => {
      for (let i = 0; i < 20; i += 1) {
        const processExists = await this.checkIfProcessExists(pid);
        if (!processExists) {
          resolve();
          return;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      logger.error(`Timeout when stopping process ${pid}`);
      reject(new Error(`FFMpegProcessManager timed out when stopping process ${pid}`));
    });
    logger.info(`Sending SIGTERM to process ${pid}`);
    try {
      process.kill(pid, 'SIGTERM');
    } catch (error) {
      logger.error(`Error with SIGTERM signal on process ${pid}: ${error.message}`);
    }
    const sigkillTimeout = setTimeout(async () => {
      const processExists = await this.checkIfProcessExists(pid);
      if (!processExists) {
        return;
      }
      logger.info(`Sending SIGKILL to process ${pid}`);
      try {
        process.kill(pid, 'SIGKILL');
      } catch (error) {
        logger.error(`Error with SIGKILL signal on process ${pid}: ${error.message}`);
      }
    }, 10000);
    const sigquitTimeout = setTimeout(async () => {
      const processExists = await this.checkIfProcessExists(pid);
      if (!processExists) {
        return;
      }
      logger.info(`Sending SIGQUIT to ${pid}`);
      try {
        process.kill(pid, 'SIGQUIT');
      } catch (error) {
        logger.error(`Error with SIGQUIT signal on process ${pid}: ${error.message}`);
      }
    }, 15000);
    await exitPromise;
    clearTimeout(sigkillTimeout);
    clearTimeout(sigquitTimeout);
    logger.info(`Stopped process ${pid}`);
    const id = this.pids.get(pid);
    if (id) {
      this.pids.delete(pid);
      this.emit('close', id);
    }
  }

  getId(args:Array<string>) {
    return farmhash.hash32(stringify(args)).toString(36);
  }

  async checkIfProcessIsUpdating(progressOutputPath: string) {
    await fs.ensureFile(progressOutputPath);
    return new Promise((resolve) => {
      const watcher = fs.watch(progressOutputPath, async (event) => {
        if (event === 'change') {
          clearTimeout(timeout);
          watcher.close();
          resolve(true);
        }
      });
      const timeout = setTimeout(() => {
        watcher.close();
        resolve(false);
      }, 3000);
    });
  }

  async startWatchingProgressOutput(id:string, progressOutputPath: string) {
    await fs.ensureFile(progressOutputPath);
    const fd = await fs.open(progressOutputPath, 'r');
    let lastSize = (await fs.fstat(fd)).size;
    const watcher = fs.watch(progressOutputPath, async (event) => {
      if (event === 'change') {
        const stat = await fs.fstat(fd);
        const delta = stat.size - lastSize;
        if (delta <= 0) {
          lastSize = stat.size;
          return;
        }
        const buffer = new Buffer(delta);
        await fs.read(fd, buffer, 0, delta, lastSize);
        lastSize = stat.size;
        const data = {};
        buffer.toString('utf-8').trim().split('\n').forEach((line) => {
          const [key, value] = line.split('=');
          data[key.trim()] = parseInt(value.replace(/[^0-9.]/g, ''), 10);
        });
        const progress = {
          fps: isNaN(data.fps) ? 0 : data.fps,
          bitrate: isNaN(data.bitrate) ? 0 : data.bitrate,
          speed: isNaN(data.speed) ? 0 : data.speed,
        };
        this.emit('progress', id, progress);
        this.progress.set(id, progress);
      }
    });
    return async () => {
      await fs.close(fd);
      watcher.close();
    };
  }

  startProcess(id:string, args:Array<string>, progressOutputPath: string):child_process$ChildProcess { // eslint-disable-line camelcase
    const combinedArgs = ['-v', 'quiet', '-nostats', '-progress', `"${progressOutputPath}"`].concat(args);
    const mainProcess = spawn(`"${ffmpegPath}"`, combinedArgs, {
      windowsHide: true,
      shell: true,
      detached: true,
    });
    mainProcess.stdout.on('data', (data) => {
      data.toString('utf8').trim().split('\n').forEach((line) => logger.debug(line));
    });
    mainProcess.stderr.on('data', (data) => {
      data.toString('utf8').trim().split('\n').forEach((line) => logger.error(line));
    });
    mainProcess.once('error', async (error) => {
      logger.error(error.message);
    });
    mainProcess.once('close', async (code) => {
      if (code && code !== 255) {
        logger.error(`Process ${mainProcess.pid} with ID ${id} exited with error code ${code}`);
      }
    });
    logger.info(`Started process ${mainProcess.pid} with ID ${id}`);
    return mainProcess;
  }

  async start(args:Array<string>) {
    await this.init();
    const id = this.getId(args);
    const progressOutputPath = path.resolve(path.join(this.outputPath, `${id}.log`));
    let existingPid;
    let processIsUpdating;
    const processes = await this.getFFMpegProcesses();
    const stringifiedArgs = JSON.stringify(args);
    for (const [ffmpegProcessId, ffmpegArgs] of processes) {
      if (JSON.stringify(ffmpegArgs) === stringifiedArgs) {
        existingPid = ffmpegProcessId;
        processIsUpdating = await this.checkIfProcessIsUpdating(progressOutputPath);
        if (processIsUpdating) {
          logger.info(`Found updating process ${existingPid} with ID ${id}`);
        } else {
          logger.warn(`Killing non-updating process ${existingPid} with ID ${id}`);
          await this.killProcess(existingPid);
        }
        break;
      }
    }
    const pid = existingPid && processIsUpdating ? existingPid : (this.startProcess(id, args, progressOutputPath)).pid;
    this.pids.set(pid, id);
    const stopWatchingProgressOutput = await this.startWatchingProgressOutput(id, progressOutputPath);
    const closePromise = new Promise((resolve, reject) => {
      this.once('error', reject);
      this.once('close', async (closedProcessId:string) => {
        if (closedProcessId === id) {
          logger.info(`Cleaning up process ${pid} with ID ${id} after close`);
          await stopWatchingProgressOutput();
          await fs.remove(progressOutputPath);
        }
      });
    });
    return [id, pid, async () => {
      if (this.pids.has(pid)) {
        await this.killProcess(pid);
        await closePromise;
      }
    }];
  }
}

module.exports = FFMpegProcessManager;
