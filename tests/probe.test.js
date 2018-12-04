// @flow

// const expect = require('expect');
const { FFmpegProcessManager, FFprobeProcessError, startFFprobe, shutdownFFprobe } = require('../src');
const testArgs = require('./lib/test-args');

jest.setTimeout(60000);

describe('FFprobe', () => {
  const processManager = new FFmpegProcessManager({ updateIntervalSeconds: 1 });
  let ffmpegJobId;

  beforeAll(async () => {
    ffmpegJobId = (await processManager.start(testArgs))[0];
  });

  afterAll(async () => {
    await shutdownFFprobe();
    await processManager.stop(ffmpegJobId);
    await processManager.shutdown();
  });

  test('Should probe the test stream', async () => {
    const args = [
      '-f', 'mpegts',
      '-i', 'udp://127.0.0.1:2222',
    ];
    await startFFprobe(args);
  });

  test('Should fail to probe stream which does not exist', async () => {
    const args = [
      '-f', 'mpegts',
      '-i', 'udp://127.0.0.1:2223',
    ];
    try {
      await startFFprobe(args);
    } catch (error) {
      expect(error).toBeInstanceOf(FFprobeProcessError);
      expect(error.message).toEqual(expect.stringMatching(/FFprobe process [0-9]+ exited with error code 1 and internal error code -5: Input\/output error/));
      expect(error.code).toEqual(-5);
      expect(error.stack).toBeDefined();
      expect(error.stdout).toBeDefined();
      expect(error.stderr.length).toEqual(0);
    }
  });
});
