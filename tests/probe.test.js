// @flow

const expect = require('expect');
const { FFmpegProcessManager, FFprobeProcessError, startFFprobe, shutdownFFprobe } = require('../src');
const testArgs = require('./lib/test-args');

jest.setTimeout(60000);

describe('FFprobe', () => {
  const processManager = new FFmpegProcessManager({ updateIntervalSeconds: 1 });

  beforeAll(async () => {
    await processManager.start(testArgs);
  });

  afterAll(async () => {
    await shutdownFFprobe();
    await processManager.stopAll();
    await processManager.shutdown();
  });

  test('Should probe the test stream', async () => {
    const args = [
      '-f', 'mpegts',
      '-i', 'udp://127.0.0.1:2222',
    ];
    const data = await startFFprobe(args);
    expect(data).toEqual(expect.objectContaining({
      streams: expect.arrayContaining([expect.objectContaining({
        index: expect.any(Number),
        codec_name: expect.any(String),
        codec_long_name: expect.any(String),
        codec_type: expect.any(String),
        codec_time_base: expect.any(String),
        codec_tag_string: expect.any(String),
        codec_tag: expect.any(String),
      })]),
      format: expect.objectContaining({
        filename: expect.any(String),
        nb_streams: expect.any(Number),
        nb_programs: expect.any(Number),
        format_name: expect.any(String),
        format_long_name: expect.any(String),
        start_time: expect.any(String),
        probe_score: expect.any(Number),
      }),
    }));
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
      expect(error).toEqual(expect.objectContaining({
        message: expect.stringMatching(/FFprobe process [0-9]+ exited with error code 1 and internal error code [-0-9]+: .*/),
        code: expect.any(Number),
        stack: expect.any(String),
        stdout: expect.any(Object),
        stderr: [],
      }));
    }
  });

  test('Should not fail on test stream probe', async () => {
    const args = [
      '-f', 'lavfi',
      '-i', 'testsrc=rate=30:size=1920x1080,format=yuv420p',
    ];
    const data = await startFFprobe(args);
    expect(data).toEqual(expect.objectContaining({
      streams: expect.arrayContaining([expect.objectContaining({
        index: expect.any(Number),
        codec_name: expect.any(String),
        codec_long_name: expect.any(String),
        codec_type: expect.any(String),
        codec_time_base: expect.any(String),
        codec_tag_string: expect.any(String),
        codec_tag: expect.any(String),
      })]),
      format: expect.objectContaining({
        filename: expect.any(String),
        nb_streams: expect.any(Number),
        nb_programs: expect.any(Number),
        format_name: expect.any(String),
        format_long_name: expect.any(String),
        start_time: expect.any(String),
        probe_score: expect.any(Number),
      }),
    }));
  });

  test('Should not fail on test stream probe with system ffprobe binary', async () => {
    const args = [
      '-f', 'lavfi',
      '-i', 'testsrc=rate=30:size=1920x1080,format=yuv420p',
    ];
    const useSystemBinary = true;
    const data = await startFFprobe(args, useSystemBinary);
    expect(data).toEqual(expect.objectContaining({
      streams: expect.arrayContaining([expect.objectContaining({
        index: expect.any(Number),
        codec_name: expect.any(String),
        codec_long_name: expect.any(String),
        codec_type: expect.any(String),
        codec_time_base: expect.any(String),
        codec_tag_string: expect.any(String),
        codec_tag: expect.any(String),
      })]),
      format: expect.objectContaining({
        filename: expect.any(String),
        nb_streams: expect.any(Number),
        nb_programs: expect.any(Number),
        format_name: expect.any(String),
        format_long_name: expect.any(String),
        start_time: expect.any(String),
        probe_score: expect.any(Number),
      }),
    }));
  });
});
