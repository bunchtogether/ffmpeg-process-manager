// @flow

// const expect = require('expect');
const { FFmpegProcessManager } = require('../src');
const { waitForStdErr } = require('./lib/events');

jest.setTimeout(60000);

describe('FFmpeg Process Manager Error Output', () => {
  const processManager = new FFmpegProcessManager({ updateIntervalSeconds: 1 });

  beforeAll(async () => {
    await processManager.init();
  });

  afterAll(async () => {
    await processManager.stopAll();
    await processManager.shutdown();
  });

  test('Should emit error messages', async () => {
    const args = ['-f', 'lavfi', '-re', '-i', 'badfilter=size=1280x720:rate=30', '-f', 'mpegts', 'udp://127.0.0.1:2222'];
    const [ffmpegJobId] = await processManager.start(args, { skipRestart: true });
    const errorMessage = await waitForStdErr(processManager, ffmpegJobId);
    expect(errorMessage).toEqual(expect.stringContaining('badfilter'));
    await processManager.stop(ffmpegJobId);
  });
});
