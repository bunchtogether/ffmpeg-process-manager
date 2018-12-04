// @flow

class FFprobeProcessError extends Error {
  code:number;
  stdout:Object | void;
  stderr:Array<string>;

  constructor(message:string, code:number, stderr: Array<string>, stdout?: Object) {
    super(message);
    this.stdout = stdout;
    this.stderr = stderr;
    this.code = code;
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = FFprobeProcessError;
