# FFmpeg Process Manager

## Usage
```js
    // Process Manager
    const { FFmpegProcessManager } = require('@bunchtogether/ffmpeg-process-manager');

    // ffmpeg process manager instance
    // @param updateIntervalSeconds  {integer=10}  Emits the status event at every <integer> secs
    // @param useSystemBinary  {boolean=false}  Uses system ffmpeg binary rather than
    //                                        the ffmpeg-static ones when set to true
    // @returns <FFmpegProcessManager>
    const processManager = new FFmpegProcessManager({
      updateIntervalSeconds: 10,
      useSystemBinary: false
    })



    const { startFFprobe } = require('@bunchtogether/ffmpeg-process-manager');

    // ffprobe check
    // @param args  {string[]} ffprobe input arguments
    // @param useSystemBinary  {boolean=false} Uses system ffmpeg binary rather than
    //                                   the ffmpeg-static ones when set to true
    const data = await startFFprobe(args, useSystemBinary);
```