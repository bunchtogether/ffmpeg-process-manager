// @flow

const expect = require('expect');
const { ffmpegPath } = require('@bunchtogether/ffmpeg-static');
const ps = require('ps-node');
const { FFmpegProcessManager, TemporaryFFmpegProcessError } = require('../src');

jest.setTimeout(60000);

const getFFmpegProcesses = ():Promise<Map<number, Array<string>>> => new Promise((resolve, reject) => {
  ps.lookup({ command: ffmpegPath }, (error, resultList) => {
    if (error) {
      reject(error);
    } else {
      const processes = new Map();
      resultList.forEach((result) => {
        processes.set(parseInt(result.pid, 10), result.arguments);
      });
      resolve(processes);
    }
  });
});

describe('FFmpeg Process Manager Temporary Process', () => {
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
      '-f', 'null', '-',
    ];
    try {
      await processManager.startTemporary(args, 1000);
    } catch (error) {
      expect(error).toBeInstanceOf(TemporaryFFmpegProcessError);
      expect(error).toEqual(expect.objectContaining({
        message: expect.stringMatching(/Temporary FFmpeg process [0-9]+ exited with error code 1/),
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
      '-f', 'null', '-',
    ];
    const temporaryProcessPromise = processManager.startTemporary(args, 2000);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const allFFmpegProcesses = await getFFmpegProcesses();
    const processes = await processManager.getFFmpegProcesses();
    expect(allFFmpegProcesses.size).toEqual(1);
    expect(processes.size).toEqual(0);
    await temporaryProcessPromise;
  });
});
