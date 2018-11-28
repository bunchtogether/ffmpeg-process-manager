// @flow

const expect = require('expect');
const FFMpegProcessManager = require('../src/process-manager');

jest.setTimeout(60000);

describe('FFMpeg Process Manager Data Output', () => {
  const processManager = new FFMpegProcessManager({ updateIntervalSeconds: 1 });

  beforeAll(async () => {
    await processManager.init();
  });

  afterAll(async () => {
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
    const ffmpegProcessArgs = ['-f', 'lavfi', '-re', '-i', 'testsrc=size=1280x720:rate=30', '-f', 'mpegts', 'udp://127.0.0.1:2222'];
    const [ffmpegJobId, ffmpegProcessId] = await processManager.start(ffmpegProcessArgs, { skipRestart: true });
    const processes = await processManager.getFFMpegProcesses();
    expect(processes.size).toEqual(1);
    for (const [pid, args] of processes) {
      expect(pid).toEqual(ffmpegProcessId);
      expect(args).toEqual(ffmpegProcessArgs);
    }
    await processManager.stop(ffmpegJobId);
  });

  test('Should get a FFMpeg process’s CPU and memory usage', async () => {
    const [ffmpegJobId, ffmpegProcessId] = await processManager.start(['-f', 'lavfi', '-re', '-i', 'testsrc=size=1280x720:rate=30', '-f', 'mpegts', 'udp://127.0.0.1:2222']);
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

  test('Should get a FFMpeg process’s progress', async () => {
    const [ffmpegJobId] = await processManager.start(['-f', 'lavfi', '-re', '-i', 'testsrc=size=1280x720:rate=30', '-f', 'mpegts', 'udp://127.0.0.1:2222']);
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
    await processManager.stop(ffmpegJobId);
  });

  test('Should get a FFMpeg process’s full status', async () => {
    const [ffmpegJobId] = await processManager.start(['-f', 'lavfi', '-re', '-i', 'testsrc=size=1280x720:rate=30', '-f', 'mpegts', 'udp://127.0.0.1:2222']);
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
    await processManager.stop(ffmpegJobId);
  });
});
