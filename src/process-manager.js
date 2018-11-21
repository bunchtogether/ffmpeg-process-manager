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

class FFMpegProcessManager extends EventEmitter {
  logger: {[string]: (s:string) => void};
  ready: Promise<void>;
  outputPath: string;
  networkUsage: {[string]: {bytesIn: string, bytesOut: string}};
  monitoringProcessNetworkUsage: boolean;
  
  constructor(options: Object = {}) {
    super();
    if (options.logger) {
      this.logger = options.logger;
    } else {
      this.logger = {
        emerg: (s) => console.error(s),
        alert: (s) => console.error(s),
        crit: (s) => console.error(s),
        error: (s) => console.error(s),
        warn: (s) => console.error(s),
        warning: (s) => console.error(s),
        notice: (s) => console.log(s),
        info: (s) => console.log(s),
        debug: (s) => console.log(s),
      };
    }
    this.outputPath = path.resolve(path.join(os.tmpdir(), 'node-ffmpeg-process-manager'));
    this.ready = this.init();
    this.networkUsage = {};
    this.monitoringProcessNetworkUsage = false;
  }

  async init() {
    await fs.ensureDir(this.outputPath);
    const stopMonitoringProcessNetworkUsage = this.monitorProcessNetworkUsage();
    const shutdown = async () => {
      if (this.monitoringProcessNetworkUsage) {
        await stopMonitoringProcessNetworkUsage();
      }
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
    process.on('SIGBREAK', shutdown);
    process.on('SIGHUP', shutdown);
  }

  monitorProcessNetworkUsage() {
    this.monitoringProcessNetworkUsage = true;
    const { logger } = this;
    const networkUsageProcess = spawn('nettop', ['-s', '1', '-L', '0', '-P', '-d', '-x', '-J', 'bytes_in,bytes_out', '-t', 'external'], {
      windowsHide: true,
      shell: true,
      detached: true,
    });
    let lastUpdate = Date.now();
    networkUsageProcess.stdout.on('data', (data) => {
      const processMap = {};
      const now = Date.now();
      const delta = now - lastUpdate;
      lastUpdate = now;
      data.toString('utf8').trim().split('\n').forEach((row) => {
        const columns = row.split(',');
        if (columns.length < 3) {
          return;
        }
        const pid = columns[0].split('.')[1];
        if (!pid) {
          return;
        }
        const bytesIn = Math.round(1000 * parseInt(columns[1], 10) / delta);
        const bytesOut = Math.round(1000 * parseInt(columns[2], 10) / delta);
        processMap[pid] = { bytesIn, bytesOut };
      });
      this.networkUsage = processMap;
      console.log(JSON.stringify(this.networkUsage, null, 2));
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
    return async () => {
      this.killProcess(networkUsageProcess.pid);
      this.monitoringProcessNetworkUsage = false;
    };
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
    const { logger } = this;
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

  async startWatching(id:string, progressOutputPath: string) {
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
          data[key] = value;
        });
        this.emit('progress', id, data);
      }
    });
    return async () => {
      await fs.close(fd);
      watcher.close();
    };
  }

  startProcess(id:string, args:Array<string>, progressOutputPath: string):number {
    const { logger } = this;
    const combinedArgs = ['-v', 'quiet', '-nostats', '-progress', `"${progressOutputPath}"`].concat(args);
    // const mainProcess = spawn(`"${ffmpegPath}"`, combinedArgs, {
    //  windowsHide: true,
    //  shell: true,
    //  detached: true,
    // });
    const mainProcess = spawn('ping', ['localhost'], {
      windowsHide: true,
      shell: true,
      detached: true,
    });
    mainProcess.stdout.on('data', (data) => {
      data.toString('utf8').trim().split('\n').forEach((line) => logger.debug(line.trim()));
    });
    mainProcess.stderr.on('data', (data) => {
      data.toString('utf8').trim().split('\n').forEach((line) => logger.error(line.trim()));
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
    return mainProcess.pid;
  }

  async start(args:Array<string>) {
    const { logger } = this;
    await this.ready;
    const id = this.getId(args);
    const progressOutputPath = path.resolve(path.join(this.outputPath, `${id}.log`));
    const pidPath = path.resolve(path.join(this.outputPath, `${id}.pid`));
    const exists = await fs.exists(pidPath);
    let existingPid;
    let processExists;
    let processIsUpdating;
    if (exists) {
      existingPid = parseInt(await fs.readFile(pidPath), 10);
      if (existingPid) {
        logger.info(`Found PID file for process ${existingPid} with ID ${id}`);
        processExists = await this.checkIfProcessExists(existingPid);
        if (processExists) {
          logger.info('\t* Process exists');
          processIsUpdating = await this.checkIfProcessIsUpdating(progressOutputPath);
          if (processIsUpdating) {
            logger.info('\t* Process is updating');
          } else {
            logger.warn(`Killing non-updating process ${existingPid} with ID ${id}`);
            await this.killProcess(existingPid);
          }
        } else {
          logger.warn(`Process ${existingPid} with ID ${id} does not exist`);
        }
      }
    }
    const pid = existingPid && processExists && processIsUpdating ? existingPid : this.startProcess(id, args, progressOutputPath);
    logger.info(`Writing PID ${pid.toString(10)} to ${pidPath}`);
    await fs.writeFile(pidPath, pid.toString(10));
    const stopWatching = await this.startWatching(id, progressOutputPath);
    return async () => {
      await stopWatching();
      await this.killProcess(pid);
      await fs.remove(progressOutputPath);
      await fs.remove(pidPath);
    };
  }
}

module.exports = FFMpegProcessManager;
