//      

class NullCheckFFmpegProcessError extends Error {
              
                       

  constructor(message       , code       , stderr               ) {
    super(message);
    this.stderr = stderr;
    this.code = code;
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = NullCheckFFmpegProcessError;
