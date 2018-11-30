// @flow

const expect = require('expect');
const { FFMpegProcessManager } = require('../src');
const { waitForClose, waitForStatus } = require('./lib/events');

jest.setTimeout(60000);

describe('FFMpeg Process Manager Process Management', () => {
  test('Should attach to existing processes', async () => {
    const processManagerA = new FFMpegProcessManager({ updateIntervalSeconds: 1 });
    const processManagerB = new FFMpegProcessManager({ updateIntervalSeconds: 1 });
    const args = ['-f', 'lavfi', '-re', '-i', 'testsrc=size=1280x720:rate=30', '-f', 'mpegts', 'udp://127.0.0.1:2222'];
    const [ffmpegJobId, ffmpegJobPid] = await processManagerA.start(args); // eslint-disable-line no-unused-vars
    await processManagerB.init();
    const statusA = await waitForStatus(processManagerA, ffmpegJobId);
    expect(statusA).toEqual({
      bitrateIn: expect.any(Number),
      bitrateOut: expect.any(Number),
      cpu: expect.any(Number),
      memory: expect.any(Number),
      droppedFrames: expect.any(Number),
      fps: expect.any(Number),
      bitrate: expect.any(Number),
      speed: expect.any(Number),
    });
    const statusB = await waitForStatus(processManagerB, ffmpegJobId);
    expect(statusB).toEqual({
      bitrateIn: expect.any(Number),
      bitrateOut: expect.any(Number),
      cpu: expect.any(Number),
      memory: expect.any(Number),
      droppedFrames: expect.any(Number),
      fps: expect.any(Number),
      bitrate: expect.any(Number),
      speed: expect.any(Number),
    });
    const closeAPromise = waitForClose(processManagerA, ffmpegJobId);
    const closeBPromise = waitForClose(processManagerB, ffmpegJobId);
    await Promise.all([processManagerA.stop(ffmpegJobId), processManagerB.stop(ffmpegJobId)]);
    await Promise.all([closeAPromise, closeBPromise]);
    await processManagerA.shutdown();
    await processManagerB.shutdown();
  });
  test('Should restart a stopped process', async () => {
    const processManager = new FFMpegProcessManager({ updateIntervalSeconds: 1 });
    const args = ['-f', 'lavfi', '-re', '-i', 'testsrc=size=1280x720:rate=30', '-f', 'mpegts', 'udp://127.0.0.1:2222'];
    const [ffmpegJobId, ffmpegJobPid] = await processManager.start(args); // eslint-disable-line no-unused-vars
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
  test('Should start a test source', async () => {
    const processManager = new FFMpegProcessManager({ updateIntervalSeconds: 1 });
    const [ffmpegJobId] = await processManager.startTestSource('rtp://127.0.0.1:2222'); // eslint-disable-line no-unused-vars
    await waitForStatus(processManager, ffmpegJobId);
    await processManager.stop(ffmpegJobId);
    await processManager.shutdown();
  });
});
