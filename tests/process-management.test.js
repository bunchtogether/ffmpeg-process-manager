// @flow

const expect = require('expect');
const { ffmpegPath, ffmpegSystemPath } = require('@bunchtogether/ffmpeg-static');
const { FFmpegProcessManager } = require('../src');
const { waitForClose, waitForStatus } = require('./lib/events');
const testArgs = require('./lib/test-args');

jest.setTimeout(60000);

describe('FFmpeg Process Manager Process Management', () => {
  test.skip('Should attach to existing processes', async () => {
    const processManagerA = new FFmpegProcessManager({ updateIntervalSeconds: 1 });
    const processManagerB = new FFmpegProcessManager({ updateIntervalSeconds: 1 });
    const [ffmpegJobId, ffmpegJobPid] = await processManagerA.start(testArgs); // eslint-disable-line no-unused-vars
    await processManagerA.shutdown();
    await processManagerB.init();
    const statusB = await waitForStatus(processManagerB, ffmpegJobId);
    expect(statusB).toEqual({
      cpu: expect.any(Number),
      memory: expect.any(Number),
      droppedFrames: expect.any(Number),
      fps: expect.any(Number),
      bitrate: expect.any(Number),
      speed: expect.any(Number),
    });
    const closeBPromise = waitForClose(processManagerB, ffmpegJobId);
    await processManagerB.stop(ffmpegJobId);
    await closeBPromise;
    await processManagerB.shutdown();
  });
  test('Should restart a stopped process', async () => {
    const processManager = new FFmpegProcessManager({ updateIntervalSeconds: 1 });
    const [ffmpegJobId, ffmpegJobPid] = await processManager.start(testArgs); // eslint-disable-line no-unused-vars
    await waitForStatus(processManager, ffmpegJobId);
    const closePromise1 = waitForClose(processManager, ffmpegJobId);
    process.kill(ffmpegJobPid, 'SIGTERM');
    await closePromise1;
    await waitForStatus(processManager, ffmpegJobId);
    const closePromise2 = waitForClose(processManager, ffmpegJobId);
    await processManager.stop(ffmpegJobId);
    await closePromise2;
    await processManager.shutdown();
  });

  test('Should not use system binaries to start process', async () => {
    const processManager = new FFmpegProcessManager({ updateIntervalSeconds: 1, useSystemBinary: false });
    expect(processManager.ffmpegPath).toEqual(ffmpegPath);
    const [ffmpegJobId, ffmpegJobPid] = await processManager.start(testArgs); // eslint-disable-line no-unused-vars
    await waitForStatus(processManager, ffmpegJobId);
    const closePromise = waitForClose(processManager, ffmpegJobId);
    await processManager.stop(ffmpegJobId);
    await closePromise;
    await processManager.shutdown();
  });

  test('Should use system binaries to start process', async () => {
    const processManager = new FFmpegProcessManager({ updateIntervalSeconds: 1, useSystemBinary: true });
    expect(processManager.ffmpegPath).toEqual(ffmpegSystemPath);
    const [ffmpegJobId, ffmpegJobPid] = await processManager.start(testArgs); // eslint-disable-line no-unused-vars
    await waitForStatus(processManager, ffmpegJobId);
    const closePromise = waitForClose(processManager, ffmpegJobId);
    await processManager.stop(ffmpegJobId);
    await closePromise;
    await processManager.shutdown();
  });
});
