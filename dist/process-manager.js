//      

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
const commandExists = require('command-exists');
const mergeAsyncCalls = require('./merge-async-calls');

                    
                                
  

                         
                     
                       
  

const nethogsRegex = /([0-9]+)\/[0-9]+\t([0-9.]+)\t([0-9.]+)/g;

class FFMpegProcessManager extends EventEmitter {
                       
                     
                                                   // eslint-disable-line camelcase
                                                                     
                                                                       
                       
                                
                            
                           
                                                                 
                          
                   
                                                                
                                                                         

  constructor(options              = {}) {
    super();
    this.outputPath = path.resolve(path.join(os.tmpdir(), 'node-ffmpeg-process-manager'));
    this.networkUsage = new Map();
    this.progress = new Map();
    this.keepAlive = {};
    this.updateIntervalSeconds = options.updateIntervalSeconds || 10;
    this.pids = new Map();
    this.ids = new Map();
    this.isShuttingDown = false;
    this.platform = os.platform();
    this.closeHandlers = new Map();
    this.start = mergeAsyncCalls(this._start.bind(this)); // eslint-disable-line  no-underscore-dangle
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
        try {
          switch (this.platform) {
            case 'linux':
              try {
                await commandExists('unbuffer');
              } catch (error) {
                throw new Error('Missing required command \'unbuffer\'');
              }
              try {
                await commandExists('nethogs');
              } catch (error) {
                throw new Error('Missing required command \'nethogs\'');
              }
              break;
            case 'darwin':
              try {
                await commandExists('unbuffer');
              } catch (error) {
                throw new Error('Missing required command \'unbuffer\'');
              }
              try {
                await commandExists('nettop');
              } catch (error) {
                throw new Error('Missing required command \'nettop\'');
              }
              break;
            default:
              throw new Error(`Platform ${this.platform} is not supported`);
          }
          await fs.ensureDir(this.outputPath);
          await this.cleanupProcesses();
          await this.monitorProcessNetworkUsage();
          this.interval = setInterval(() => this.updateStatus(), this.updateIntervalSeconds * 1000);
          const processes = await this.getFFMpegProcesses();
          for (const [pid, args] of processes) {
            logger.warn(`Found FFMpeg process ${pid} on init, starting with [${args.join(', ')}]`);
            await this.start(args, { skipInit: true });
          }
        } catch (error) {
          if (error.stack) {
            logger.error('Unable to start ffmpeg-process-manager:');
            error.stack.split('\n').forEach((line) => logger.error(`\t${line.trim()}`));
          } else {
            logger.error(`'Unable to start ffmpeg-process-manager:' ${error.message}`);
          }
          await new Promise((resolve) => setTimeout(resolve, 1000));
          process.exit(1);
        }
      })();
    }
    return this.ready;
  }

  async cleanupProcesses() {
    const processes = await this.getFFMpegProcesses();
    const map = new Map();
    for (const [pid, args] of processes) {
      const id = this.getId(args);
      map.set(id, pid);
    }
    for (const [pid, args] of processes) {
      const id = this.getId(args);
      if (map.get(id) !== pid) {
        await this.killProcess(pid, 'redundant FFMpeg process');
      }
    }
  }

  async shutdown() {
    if (!this.isShuttingDown) {
      this.isShuttingDown = true;
      clearInterval(this.interval);
      if (this.networkUsageProcess) {
        await this.killProcess(this.networkUsageProcess.pid, 'network usage monitoring');
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

  getCpuAndMemoryUsage(pids              )                                                     {
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

  getFFMpegProcesses()                                     {
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

  monitorProcessNetworkUsage() {
    if (this.platform === 'darwin') {
      return this.monitorProcessNetworkUsageDarwin();
    } else if (this.platform === 'linux') {
      return this.monitorProcessNetworkUsageLinux();
    }
    throw new Error(`Platform ${this.platform} is not supported`);
  }

  monitorProcessNetworkUsageDarwin() {
    const networkUsageProcess = spawn('unbuffer', ['nettop', '-s', this.updateIntervalSeconds.toString(), '-L', '0', '-P', '-d', '-x', '-J', 'bytes_in,bytes_out', '-t', 'external'], {
      windowsHide: true,
      shell: false,
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
      if (!this.isShuttingDown) {
        logger.error('Restarting network usage process');
        await new Promise((resolve) => setTimeout(resolve, 1000));
        this.monitorProcessNetworkUsage();
      }
    });
    this.networkUsageProcess = networkUsageProcess;
  }

  monitorProcessNetworkUsageLinux() {
    const networkUsageProcess = spawn('unbuffer', ['nethogs', '-t', '-d', this.updateIntervalSeconds.toString()], {
      windowsHide: true,
      shell: false,
    });
    networkUsageProcess.stdout.on('data', (data) => {
      const networkUsage = new Map();
      data.toString('utf8').split('\n').forEach((line) => {
        const match = nethogsRegex.exec(line);
        if (!match) {
          return;
        }
        const pid = parseInt(match[1], 10);
        const bitrateOut = 8000 * parseInt(match[2], 10);
        const bitrateIn = 8000 * parseInt(match[3], 10);
        networkUsage.set(pid, { bitrateIn, bitrateOut });
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
      if (!this.isShuttingDown) {
        logger.error('Restarting network usage process');
        await new Promise((resolve) => setTimeout(resolve, 1000));
        this.monitorProcessNetworkUsage();
      }
    });
    this.networkUsageProcess = networkUsageProcess;
  }

  checkIfProcessExists(pid       )                   {
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

  async cleanupJob(id       ) {
    const pid = this.ids.get(id);
    if (!pid) {
      return;
    }
    this.pids.delete(pid);
    this.ids.delete(id);
    await this.runCloseHandlers(id);
  }

  async killProcess(pid       , name       ) {
    let processExists = await this.checkIfProcessExists(pid);
    const exitPromise = new Promise(async (resolve, reject) => {
      for (let i = 0; i < 40; i += 1) {
        if (!processExists) {
          resolve();
          return;
        }
        await new Promise((r) => setTimeout(r, 500));
        processExists = await this.checkIfProcessExists(pid);
      }
      logger.error(`Timeout when stopping ${name} process ${pid}`);
      reject(new Error(`FFMpegProcessManager timed out when stopping ${name} process ${pid}`));
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
  }

  getId(args              ) {
    return farmhash.hash32(stringify(args)).toString(36);
  }

  getProgressOutputPath(args              ) {
    const id = this.getId(args);
    return path.resolve(path.join(this.outputPath, `${id}.log`));
  }

  getErrorOutputPath(args              ) {
    const id = this.getId(args);
    return path.resolve(path.join(this.outputPath, `${id}.err`));
  }

  async checkIfProcessIsUpdating(args              ) {
    const progressOutputPath = this.getProgressOutputPath(args);
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
      }, 10000);
    });
  }

  async startWatchingProgressOutput(id       , progressOutputPath        ) {
    await fs.ensureFile(progressOutputPath);
    let lastSize = (await fs.stat(progressOutputPath)).size;
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
    const watcher = fs.watch(progressOutputPath, async (event) => {
      if (event === 'change') {
        try {
          const stat = await fs.stat(progressOutputPath);
          const delta = stat.size - lastSize;
          if (delta <= 0) {
            lastSize = stat.size;
            return;
          }
          const buffer = new Buffer(delta);
          const fd = await fs.open(progressOutputPath, 'r');
          await fs.read(fd, buffer, 0, delta, lastSize);
          await fs.close(fd);
          lastSize = stat.size;
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
        } catch (error) {
          if (error.stack) {
            logger.error(`Unable to get progress of FFMpeg process with ID ${id}:`);
            error.stack.split('\n').forEach((line) => logger.error(`\t${line.trim()}`));
          } else {
            logger.error(`Unable to get progress of FFMpeg process with ID ${id}:' ${error.message}`);
          }
        }
      }
    });
    const close = async () => {
      watcher.close();
    };
    return () => close();
  }

  async startWatchingErrorOutput(id       , errorOutputPath        ) {
    await fs.ensureFile(errorOutputPath);
    let lastSize = (await fs.stat(errorOutputPath)).size;
    const watcher = fs.watch(errorOutputPath, async (event) => {
      if (event === 'change') {
        try {
          const stat = await fs.stat(errorOutputPath);
          const delta = stat.size - lastSize;
          if (delta <= 0) {
            lastSize = stat.size;
            return;
          }
          const buffer = new Buffer(delta);
          const fd = await fs.open(errorOutputPath, 'r');
          await fs.read(fd, buffer, 0, delta, lastSize);
          await fs.close(fd);
          lastSize = stat.size;
          const output = buffer.toString('utf-8').trim();
          const pid = this.ids.get(id);
          if (pid) {
            logger.error(`FFMpeg process ${pid} with ID ${id}:`);
          } else {
            logger.error(`FFMpeg process with ID ${id}:`);
          }
          output.split('\n').forEach((line) => logger.error(`\t${line.trim()}`));
          this.emit('stderr', id, output);
        } catch (error) {
          if (error.stack) {
            logger.error(`Unable to get stderr of FFMpeg process with ID ${id}:`);
            error.stack.split('\n').forEach((line) => logger.error(`\t${line.trim()}`));
          } else {
            logger.error(`Unable to get stderr of FFMpeg process with ID ${id}:' ${error.message}`);
          }
        }
      }
    });
    const close = async () => {
      watcher.close();
    };
    return () => close();
  }

  async restart(id       ) {
    const keepAliveData = this.keepAlive[id];
    if (!keepAliveData) {
      return;
    }
    logger.warn(`Restarting process with ID ${id}`);
    const { attempt, args } = keepAliveData;
    this.keepAlive[id] = { attempt: attempt + 1, args };
    if (attempt < 6) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt * attempt));
    } else {
      await new Promise((resolve) => setTimeout(resolve, 1000 * 36));
    }
    await this.start(args);
    logger.warn(`Restarted process with ID ${id}`);
  }

  async startProcess(args              )                                     { // eslint-disable-line camelcase
    const id = this.getId(args);
    const progressOutputPath = this.getProgressOutputPath(args);
    const combinedArgs = ['-v', 'error', '-nostats', '-progress', `${progressOutputPath}`].concat(args);
    const errorOutputPath = this.getErrorOutputPath(args);
    const stdErrFileDescriptor = await fs.open(errorOutputPath, 'a');
    const mainProcess = spawn(ffmpegPath, combinedArgs, {
      windowsHide: true,
      shell: false,
      detached: true,
      stdio: ['ignore', 'ignore', stdErrFileDescriptor],
    });
    mainProcess.once('error', async (error) => {
      logger.error(error.message);
    });
    mainProcess.once('close', async (code) => {
      if (code && code !== 255) {
        logger.error(`FFMpeg process ${mainProcess.pid} with ID ${id} exited with error code ${code}`);
      }
    });
    logger.info(`Started FFMpeg process ${mainProcess.pid} with ID ${id}`);
    await fs.close(stdErrFileDescriptor);
    return mainProcess;
  }

  async _start(args              , options                   = {}) {
    const id = this.getId(args);
    const managedPid = this.ids.get(id);
    if (managedPid) {
      logger.warn(`FFMpeg process ${managedPid} with ID ${id} is already running, skipping start`);
      return [id, managedPid];
    }
    if (!options.skipRestart) {
      this.keepAlive[id] = this.keepAlive[id] || { attempt: 0, args };
    }
    if (!options.skipInit) {
      await this.init();
    }
    let existingPid;
    let processIsUpdating;
    const processes = await this.getFFMpegProcesses();
    const stringifiedArgs = stringify(args);
    for (const [ffmpegProcessId, ffmpegArgs] of processes) {
      if (stringify(ffmpegArgs) === stringifiedArgs) {
        existingPid = ffmpegProcessId;
        processIsUpdating = await this.checkIfProcessIsUpdating(args);
        if (processIsUpdating) {
          logger.info(`Found updating FFMpeg process ${existingPid} with ID ${id}`);
        } else {
          await this.killProcess(existingPid, 'non-updating FFMpeg');
        }
        break;
      }
    }
    const progressOutputPath = this.getProgressOutputPath(args);
    const errorOutputPath = this.getErrorOutputPath(args);
    const stopWatchingProgressOutput = await this.startWatchingProgressOutput(id, progressOutputPath);
    const stopWatchingErrorOutput = await this.startWatchingErrorOutput(id, errorOutputPath);
    const pid = existingPid && processIsUpdating ? existingPid : (await this.startProcess(args)).pid;
    if (this.ids.get(id)) {
      await this.killProcess(pid, 'FFMpeg process');
      throw new Error(`Conflicting ID ${id} for FFMpeg process ${pid}`);
    }
    this.pids.set(pid, id);
    this.ids.set(id, pid);
    const closeHandler = async () => {
      try {
        await Promise.all([stopWatchingProgressOutput(), stopWatchingErrorOutput()]);
        await Promise.all([fs.remove(progressOutputPath), fs.remove(errorOutputPath)]);
        this.removeListener('close', closeHandler);
        this.restart(id);
      } catch (error) {
        if (error.stack) {
          logger.error(`Unable to close FFMpeg process ${pid} with ID ${id}:`);
          error.stack.split('\n').forEach((line) => logger.error(`\t${line.trim()}`));
        } else {
          logger.error(`Unable to close FFMpeg process ${pid} with ID ${id}:' ${error.message}`);
        }
      }
    };
    this.addCloseHandler(id, closeHandler);
    return [id, pid];
  }

  async runCloseHandlers(id       ) {
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

  addCloseHandler(id       , handler                           ) {
    const handlers = this.closeHandlers.get(id) || [];
    handlers.push(handler);
    this.closeHandlers.set(id, handlers);
  }

  async stop(id       ) {
    delete this.keepAlive[id];
    const processesBeforeClose = await this.getFFMpegProcesses();
    const pids = new Set();
    const mainPid = this.ids.get(id);
    let closePromise;
    if (mainPid) {
      pids.add(mainPid);
      closePromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error(`Timeout on close event for FFMpeg process ${mainPid} with ID ${id}`));
        }, 20000);
        this.addCloseHandler(id, () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }
    for (const [ffmpegProcessId, ffmpegArgs] of processesBeforeClose) {
      if (id === this.getId(ffmpegArgs)) {
        pids.add(ffmpegProcessId);
      }
    }
    await Promise.all([...pids].map((pid) => this.killProcess(pid, 'FFMpeg')));
    await this.cleanupJob(id);
    if (closePromise) {
      try {
        await closePromise;
      } catch (error) {
        logger.error(error.message);
      }
    }
  }
}

module.exports = FFMpegProcessManager;