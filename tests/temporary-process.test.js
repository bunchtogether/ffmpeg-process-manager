// @flow

const expect = require('expect');
const { ffmpegPath } = require('ffmpeg-static');
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
  test('Should throw an error containing the exit code and stderr output', async () => {
    const processManager = new FFmpegProcessManager({ updateIntervalSeconds: 1 });
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
      expect(error.message).toEqual(expect.stringMatching(/FFmpeg process [0-9]+ with ID [a-z0-9]+ exited with error code 1/));
      expect(error.code).toEqual(1);
      expect(error.stack).toBeDefined();
      expect(error.stderr.join('\n')).toEqual(expect.stringContaining('badfilter'));
    }
    await processManager.shutdown();
  });
  test('Should resolve on successful execution', async () => {
    const processManager = new FFmpegProcessManager({ updateIntervalSeconds: 1 });
    const args = [
      '-re',
      '-f', 'lavfi',
      '-i', 'testsrc=rate=30:size=1920x1080,format=yuv420p',
      '-f', 'null', '-',
    ];
    const temporaryProcessPromise = processManager.startTemporary(args, 2000);
    const allFFmpegProcesses = await getFFmpegProcesses();
    const processes = await processManager.getFFmpegProcesses();
    expect(allFFmpegProcesses.size).toEqual(1);
    expect(processes.size).toEqual(0);
    const stderr = await temporaryProcessPromise;
    expect(stderr).toBeInstanceOf(Array);
    expect(stderr.length).toEqual(0);
    await processManager.shutdown();
  });
});
