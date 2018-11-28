// @flow

const expect = require('expect');
const FFMpegProcessManager = require('../src/process-manager');
// const fs = require('fs-extra');

jest.setTimeout(60000);

describe('FFMpeg Process Manager Process Management', () => {
  test('Should attach to existing processes', async () => {
    const processManagerA = new FFMpegProcessManager({ updateIntervalSeconds: 1 });
    const waitForCloseA = (id) => new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout on close of managed FFMpeg process'));
      }, 30000);
      const handleClose = (closedId:string) => {
        if (closedId === id) {
          clearTimeout(timeout);
          processManagerA.removeListener('close', handleClose);
          processManagerA.removeListener('error', reject);
          resolve();
        }
      };
      processManagerA.on('close', handleClose);
      processManagerA.once('error', reject);
    });
    const processManagerB = new FFMpegProcessManager({ updateIntervalSeconds: 1 });
    const waitForCloseB = (id) => new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout on close of managed FFMpeg process'));
      }, 30000);
      const handleClose = (closedId:string) => {
        if (closedId === id) {
          clearTimeout(timeout);
          processManagerB.removeListener('close', handleClose);
          processManagerB.removeListener('error', reject);
          resolve();
        }
      };
      processManagerB.on('close', handleClose);
      processManagerB.once('error', reject);
    });
    const args = ['-i', 'https://nhkwtvglobal-i.akamaihd.net/hls/live/263941/nhkwtvglobal/index_1180.m3u8', '-c', 'copy', '-f', 'mpegts', 'udp://127.0.0.1:48550?pkt_size=1316&burst_bits=13160&reuse=1'];
    const [ffmpegJobId, ffmpegJobPid, stopFFMpegJob] = await processManagerA.start(args); // eslint-disable-line no-unused-vars
    await processManagerB.init();
    const statusA = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout for FFMpeg process’s status'));
      }, 30000);
      processManagerA.once('error', reject);
      processManagerA.once('status', (id, data) => {
        if (id === ffmpegJobId) {
          processManagerA.removeListener('error', reject);
          clearTimeout(timeout);
          resolve(data);
        }
      });
    });
    expect(statusA).toEqual({
      bitrateIn: expect.any(Number),
      bitrateOut: expect.any(Number),
      cpu: expect.any(Number),
      memory: expect.any(Number),
      fps: expect.any(Number),
      bitrate: expect.any(Number),
      speed: expect.any(Number),
    });
    const statusB = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout for FFMpeg process’s status'));
      }, 30000);
      processManagerB.once('error', reject);
      processManagerB.once('status', (id, data) => {
        if (id === ffmpegJobId) {
          processManagerB.removeListener('error', reject);
          clearTimeout(timeout);
          resolve(data);
        }
      });
    });
    expect(statusB).toEqual({
      bitrateIn: expect.any(Number),
      bitrateOut: expect.any(Number),
      cpu: expect.any(Number),
      memory: expect.any(Number),
      fps: expect.any(Number),
      bitrate: expect.any(Number),
      speed: expect.any(Number),
    });
    const closeAPromise = waitForCloseA(ffmpegJobId);
    const closeBPromise = waitForCloseB(ffmpegJobId);
    // Explicitly stop on both promise managers to avoid automatic restarts
    await Promise.all([processManagerA.stop(ffmpegJobId), processManagerB.stop(ffmpegJobId)]);
    await Promise.all([closeAPromise, closeBPromise]);
    await processManagerA.shutdown();
    await processManagerB.shutdown();
  });
  test.skip('Should restart a stopped process', async () => {
    const processManager = new FFMpegProcessManager({ updateIntervalSeconds: 1 });
    const waitForClose = (id) => new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout on close of managed FFMpeg process'));
      }, 30000);
      const handleClose = (closedId:string) => {
        if (closedId === id) {
          clearTimeout(timeout);
          processManager.removeListener('close', handleClose);
          processManager.removeListener('error', reject);
          resolve();
        }
      };
      processManager.on('close', handleClose);
      processManager.once('error', reject);
    });
    const waitForStatus = (id) => new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout on status of managed FFMpeg process'));
      }, 30000);
      const handleStatus = (statusId:string) => {
        if (statusId === id) {
          clearTimeout(timeout);
          processManager.removeListener('status', handleStatus);
          processManager.removeListener('error', reject);
          resolve();
        }
      };
      processManager.on('status', handleStatus);
      processManager.once('error', reject);
    });
    const args = ['-i', 'https://nhkwtvglobal-i.akamaihd.net/hls/live/263941/nhkwtvglobal/index_1180.m3u8', '-c', 'copy', '-f', 'mpegts', 'udp://127.0.0.1:48550?pkt_size=1316&burst_bits=13160&reuse=1'];
    const [ffmpegJobId, ffmpegJobPid] = await processManager.start(args); // eslint-disable-line no-unused-vars
    await waitForStatus(ffmpegJobId);
    await new Promise((resolve) => setTimeout(resolve, 45000));
    process.kill(ffmpegJobPid, 'SIGTERM');
    await waitForClose(ffmpegJobId);
    await waitForStatus(ffmpegJobId);
    await processManager.stop(ffmpegJobId);
    await waitForClose(ffmpegJobId);
    await processManager.shutdown();
  });
});
