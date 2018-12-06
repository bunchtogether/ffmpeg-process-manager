// @flow

class NullCheckFFmpegProcessError extends Error {
  code:number;
  stderr:Array<string>;

  constructor(message:string, code:number, stderr: Array<string>) {
    super(message);
    this.stderr = stderr;
    this.code = code;
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = NullCheckFFmpegProcessError;
