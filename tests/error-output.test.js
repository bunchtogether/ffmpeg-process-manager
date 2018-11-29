// @flow

// const expect = require('expect');
const { FFMpegProcessManager } = require('../src');
const { waitForStdErr } = require('./lib/events');

jest.setTimeout(60000);

describe('FFMpeg Process Manager Error Output', () => {
  test('Should emit error messages', async () => {
    const processManager = new FFMpegProcessManager({ updateIntervalSeconds: 1 });
    const args = ['-f', 'lavfi', '-re', '-i', 'badfilter=size=1280x720:rate=30', '-f', 'mpegts', 'udp://127.0.0.1:2222'];
    const [ffmpegJobId] = await processManager.start(args, { skipRestart: true });
    const errorMessage = await waitForStdErr(processManager, ffmpegJobId);
    expect(errorMessage).toEqual(expect.stringContaining('badfilter'));
    await processManager.stop(ffmpegJobId);
    await processManager.shutdown();
  });
});
