// @flow

const FFMpegProcessManager = require('../src/process-manager');

jest.setTimeout(60000);

describe('Hello world', () => {
  test('Hello world', async () => {
    const processManager = new FFMpegProcessManager();
    processManager.on('progress', (id, data) => {
      console.log('PROGRESS', id, data);
    });
    const args = ['-re', '-i', '"https://nhkwtvglobal-i.akamaihd.net/hls/live/263941/nhkwtvglobal/index_1180.m3u8"', '-s', '1280x720', '-r', '30', '-c:v', 'libx264', '-x264opts', 'nal-hrd=cbr:force-cfr=0', '-b:v', '3072K', '-minrate', '3072K', '-maxrate', '3072K', '-bufsize', '6M', '-strict', '-2', '-c:a', 'libmp3lame', '-b:a', '128k', '-flush_packets', '0', '-f', 'mpegts', '-g', '60', '-preset', 'slow', '-movflags', 'faststart', '"udp://10.0.1.32:48550?pkt_size=1380&bitrate=3072000&buffer_size=3072000&reuse=1"'];
    const stop = await processManager.start(args);
    await new Promise((resolve) => setTimeout(resolve, 45000));
    await stop();
  });
});
