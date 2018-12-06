//      
const { startFFprobe, shutdownFFprobe } = require('./probe');
module.exports.FFmpegProcessManager = require('./process-manager');

module.exports.startFFprobe = startFFprobe;
module.exports.shutdownFFprobe = shutdownFFprobe;
module.exports.TemporaryFFmpegProcessError = require('./lib/temporary-ffmpeg-process-error');
module.exports.FFprobeProcessError = require('./lib/ffprobe-process-error');
module.exports.NullCheckFFmpegProcessError = require('./lib/null-check-ffmpeg-process-error');
