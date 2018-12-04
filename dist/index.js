//      
const { startFFprobe, shutdownFFprobe } = require('./probe');
module.exports.FFmpegProcessManager = require('./process-manager');

module.exports.startFFprobe = startFFprobe;
module.exports.shutdownFFprobe = shutdownFFprobe;
module.exports.TemporaryFFmpegProcessError = require('./lib/temporary-ffmpeg-process-error');
module.exports.FFprobeProcessError = require('./lib/ffprobe-process-error');
