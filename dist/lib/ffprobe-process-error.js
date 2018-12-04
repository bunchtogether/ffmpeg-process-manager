//      

class FFprobeProcessError extends Error {
              
                       
                       

  constructor(message       , code       , stderr               , stdout         ) {
    super(message);
    this.stdout = stdout;
    this.stderr = stderr;
    this.code = code;
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = FFprobeProcessError;
