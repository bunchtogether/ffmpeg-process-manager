// @flow

const expect = require('expect');
const { FFmpegProcessManager, NullCheckFFmpegProcessError } = require('../src');

jest.setTimeout(60000);

describe('FFmpeg Process Manager Null Check Process', () => {
  const processManager = new FFmpegProcessManager({ updateIntervalSeconds: 1 });

  beforeAll(async () => {
    await processManager.init();
  });

  afterAll(async () => {
    await processManager.stopAll();
    await processManager.shutdown();
  });

  test('Should throw an error containing the exit code and stderr output', async () => {
    const args = [
      '-re',
      '-f', 'lavfi',
      '-i', 'badfilter=size=1280x720:rate=30',
    ];
    try {
      await processManager.startNullCheck(args);
    } catch (error) {
      expect(error).toBeInstanceOf(NullCheckFFmpegProcessError);
      expect(error).toEqual(expect.objectContaining({
        message: expect.stringMatching(/Null check FFmpeg process [0-9]+ exited with error code 1/),
        code: expect.any(Number),
        stack: expect.any(String),
        stderr: expect.arrayContaining([expect.stringContaining('badfilter')]),
      }));
    }
  });

  test('Should resolve on successful execution', async () => {
    const args = [
      '-re',
      '-f', 'lavfi',
      '-i', 'testsrc=rate=30:size=1920x1080,format=yuv420p',
    ];
    await processManager.startNullCheck(args);
  });
});
