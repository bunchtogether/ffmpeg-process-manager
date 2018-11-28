// @flow

const expect = require('expect');
const path = require('path');
const FFMpegProcessManager = require('../src/process-manager');
const fs = require('fs-extra');

jest.setTimeout(60000);

describe('FFMpeg Process Manager Data Output', () => {
  const processManager = new FFMpegProcessManager({ updateIntervalSeconds: 1 });

  const testFilePath = path.resolve(__dirname, 'test.mp4');

  const waitForClose = (id) => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timeout on close of managed FFMpeg process'));
    }, 5000);
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

  beforeAll(async () => {
    const [id] = await processManager.start(['-y', '-f', 'lavfi', '-i', 'testsrc=duration=10:size=1280x720:rate=30', testFilePath]);
    await waitForClose(id);
  });

  afterAll(async () => {
    await fs.remove(testFilePath);
    await processManager.shutdown();
  });


  test('Should monitor network usage', async () => {
    const networkUsage = await new Promise((resolve, reject) => {
      processManager.once('networkUsage', (data) => {
        processManager.removeListener('error', reject);
        resolve(data);
      });
      processManager.once('error', reject);
      processManager.init();
    });
    expect(networkUsage.size).toBeGreaterThan(0);
    for (const [pid, values] of networkUsage) {
      expect(pid).toEqual(expect.any(Number));
      expect(values).toEqual({
        bitrateIn: expect.any(Number),
        bitrateOut: expect.any(Number),
      });
    }
  });

  test('Should get managed FFMpeg processes', async () => {
    const testFilePathHalfSize = path.resolve(__dirname, 'test-half-size.mp4');
    const ffmpegProcessArgs = ['-y', '-i', testFilePath, '-vf', 'scale=iw/2:ih/2', testFilePathHalfSize];
    const [ffmpegJobId, ffmpegProcessId] = await processManager.start(ffmpegProcessArgs);
    const processes = await processManager.getFFMpegProcesses();
    expect(processes.size).toEqual(1);
    for (const [pid, args] of processes) {
      expect(pid).toEqual(ffmpegProcessId);
      expect(args).toEqual(ffmpegProcessArgs);
    }
    await waitForClose(ffmpegJobId);
    await fs.remove(testFilePathHalfSize);
  });

  test('Should get a FFMpeg process’s CPU and memory usage', async () => {
    const testFilePathHalfSize = path.resolve(__dirname, 'test-half-size.mp4');
    const [ffmpegJobId, ffmpegProcessId] = await processManager.start(['-y', '-i', testFilePath, '-vf', 'scale=iw/2:ih/2', testFilePathHalfSize]);
    const cpuAndMemoryUsage = await processManager.getCpuAndMemoryUsage([...processManager.pids.keys()]);
    expect(cpuAndMemoryUsage.size).toEqual(1);
    for (const [pid, values] of cpuAndMemoryUsage) {
      expect(pid).toEqual(ffmpegProcessId);
      expect(values).toEqual({
        cpu: expect.any(Number),
        memory: expect.any(Number),
      });
    }
    await waitForClose(ffmpegJobId);
    await fs.remove(testFilePathHalfSize);
  });

  test('Should get a FFMpeg process’s progress', async () => {
    const testFilePathHalfSize = path.resolve(__dirname, 'test-half-size.mp4');
    const [ffmpegJobId] = await processManager.start(['-y', '-i', testFilePath, '-vf', 'scale=iw/2:ih/2', testFilePathHalfSize]);
    const progress = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout for FFMpeg process’s progress'));
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
      fps: expect.any(Number),
      bitrate: expect.any(Number),
      speed: expect.any(Number),
    });
    await waitForClose(ffmpegJobId);
    await fs.remove(testFilePathHalfSize);
  });

  test('Should get a FFMpeg process’s full status', async () => {
    const testFilePathHalfSize = path.resolve(__dirname, 'test-half-size.mp4');
    const [ffmpegJobId] = await processManager.start(['-y', '-i', testFilePath, '-vf', 'scale=iw/2:ih/2', testFilePathHalfSize]);
    const status = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout for FFMpeg process’s status'));
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
      fps: expect.any(Number),
      bitrate: expect.any(Number),
      speed: expect.any(Number),
    });
    await waitForClose(ffmpegJobId);
    await fs.remove(testFilePathHalfSize);
  });
});
