// @flow

module.exports = [
  '-re',
  '-f', 'lavfi',
  '-i', 'testsrc=rate=30:size=1920x1080,format=yuv420p',
  '-re',
  '-f', 'lavfi',
  '-i', 'sine=frequency=100:sample_rate=44100:beep_factor=4',
  '-c:v', 'libx264',
  '-crf:v', '22',
  '-preset:v', 'fast',
  '-pix_fmt', 'yuv420p',
  '-x264opts', 'keyint=30:no-scenecut=1',
  '-maxrate:v', '2000k',
  '-bufsize:v', '4800k',
  '-g', '30',
  '-c:a', 'aac',
  '-ac', '2',
  '-b:a', '96k',
  '-maxrate:a', '96k',
  '-bufsize:a', '192k',
  '-preset', 'ultrafast',
  '-f', 'mpegts',
  'udp://127.0.0.1:2222',
];
