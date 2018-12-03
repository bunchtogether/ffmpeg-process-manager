// @flow

const expect = require('expect');
const { FFmpegProcessManager } = require('../src');
const testArgs = require('./lib/test-args');

jest.setTimeout(60000);

describe('FFmpeg Process Manager Data Output', () => {
  const processManager = new FFmpegProcessManager({ updateIntervalSeconds: 1 });

  beforeAll(async () => {
    await processManager.init();
  });

  afterAll(async () => {
    await processManager.shutdown();
  });

  test('Should monitor network usage', async () => {
    const networkUsage = await new Promise((resolve, reject) => {
      const handler = (data) => {
        if (data.size > 0) {
          processManager.removeListener('networkUsage', handler);
          processManager.removeListener('error', reject);
          resolve(data);
        }
      };
      processManager.on('networkUsage', handler);
      processManager.on('error', reject);
    });
    for (const [pid, values] of networkUsage) {
      expect(pid).toEqual(expect.any(Number));
      expect(values).toEqual({
        bitrateIn: expect.any(Number),
        bitrateOut: expect.any(Number),
      });
    }
  });

  test('Should get managed FFmpeg processes', async () => {
    const [ffmpegJobId, ffmpegProcessId] = await processManager.start(testArgs);
    const processes = await processManager.getFFmpegProcesses();
    expect(processes.size).toEqual(1);
    for (const [pid, args] of processes) {
      expect(pid).toEqual(ffmpegProcessId);
      expect(args).toEqual(testArgs);
    }
    await processManager.stop(ffmpegJobId);
  });

  test('Should get a FFmpeg process’s CPU and memory usage', async () => {
    const [ffmpegJobId, ffmpegProcessId] = await processManager.start(testArgs);
    const cpuAndMemoryUsage = await processManager.getCpuAndMemoryUsage([...processManager.pids.keys()]);
    expect(cpuAndMemoryUsage.size).toEqual(1);
    for (const [pid, values] of cpuAndMemoryUsage) {
      expect(pid).toEqual(ffmpegProcessId);
      expect(values).toEqual({
        cpu: expect.any(Number),
        memory: expect.any(Number),
      });
    }
    await processManager.stop(ffmpegJobId);
  });

  test('Should get a FFmpeg process’s progress', async () => {
    const [ffmpegJobId] = await processManager.start(testArgs);
    const progress = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout for FFmpeg process’s progress'));
      }, 5000);
      processManager.once('error', reject);
      processManager.once('progress', (id, data) => {
        if (id === ffmpegJobId) {
          processManager.removeListener('error', reject);
          clearTimeout(timeout);
          resolve(data);
        }
      });
    });
    expect(progress).toEqual({
      droppedFrames: expect.any(Number),
      fps: expect.any(Number),
      bitrate: expect.any(Number),
      speed: expect.any(Number),
    });
    await processManager.stop(ffmpegJobId);
  });

  test('Should get a FFmpeg process’s full status', async () => {
    const [ffmpegJobId] = await processManager.start(testArgs);
    const status = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout for FFmpeg process’s status'));
      }, 5000);
      processManager.once('error', reject);
      processManager.once('status', (id, data) => {
        if (id === ffmpegJobId) {
          processManager.removeListener('error', reject);
          clearTimeout(timeout);
          resolve(data);
        }
      });
    });
    expect(status).toEqual({
      bitrateIn: expect.any(Number),
      bitrateOut: expect.any(Number),
      cpu: expect.any(Number),
      memory: expect.any(Number),
      droppedFrames: expect.any(Number),
      fps: expect.any(Number),
      bitrate: expect.any(Number),
      speed: expect.any(Number),
    });
    await processManager.stop(ffmpegJobId);
  });

  test('Should restart the network usage process if it stops', async () => {
    await new Promise((resolve, reject) => {
      const handler = (data) => {
        if (data.size > 0) {
          processManager.removeListener('networkUsage', handler);
          processManager.removeListener('error', reject);
          resolve(data);
        }
      };
      processManager.on('networkUsage', handler);
      processManager.on('error', reject);
    });
    process.kill(processManager.networkUsageProcess.pid, 'SIGTERM');
    await new Promise((resolve, reject) => {
      const handler = (data) => {
        if (data.size > 0) {
          processManager.removeListener('networkUsage', handler);
          processManager.removeListener('error', reject);
          resolve(data);
        }
      };
      processManager.on('networkUsage', handler);
      processManager.on('error', reject);
    });
  });
});
