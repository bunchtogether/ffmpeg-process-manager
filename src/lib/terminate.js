

const psTree = require('@bunchtogether/ps-tree'); // see: http://git.io/jBHZ

function handlePsTreeCallback(
  err,
  children,
  pid,
  signal = 'SIGKILL',
  options = {},
  callback = () => {},
) {
  const pollInterval = options.pollInterval || 500;
  const timeout = options.timeout || 5000;
  if (err) {
    callback(err);
    return;
  }
  const pids = children.map((child) => parseInt(child.PID, 10));
  pids.forEach((childPid) => {
    try {
      process.kill(childPid, signal);
    } catch (error) {
      // ignore
    }
  });
  try {
    process.kill(pid, signal);
  } catch (error) {
    // don't ignore if killing the top-level process fails
    callback(error);
    return;
  }

  pids.push(pid);

  const start = Date.now();

  function getUnterminatedProcesses() {
    const result = [];
    for (let i = 0; i < pids.length; i++) {
      const childPid = pids[i];
      try {
        process.kill(childPid, 0);
        // success means it's still alive
        result.push(childPid);
      } catch (error) {
        // error means it's dead
      }
    }
    return result;
  }

  function poll() {
    const unterminated = getUnterminatedProcesses();
    if (!unterminated.length) {
      callback(null);
      return;
    } else if (Date.now() + pollInterval - start > timeout) {
      callback(new Error(`timed out waiting for pids ${unterminated.join(', ')} to exit`));
      return;
    }
    setTimeout(poll, pollInterval);
  }

  setTimeout(poll, 0);
}


/**
 * terminate is an ultra-simple way to kill all the node processes
 * by providing a process pid. It finds all child processes and shuts
 * them down too, so you don't have to worry about lingering processes.
 * @param {int} pid - the Process ID you want to terminate
 * @param {string} [signal=SIGTERM] - the signal to kill the processes
 * with.
 * @param {object} [options={}] - options object
 * @param {number} [options.pollInterval=500] - interval to poll whether pid
 * and all of the child pids have been killed.
 * @param {number} [options.timeout=5000] - max time to wait for processes to
 * exit before timing out and calling back with an error.
 * @param {function=} callback - if you want to know once the
 * procesess have been terminated, supply a callback.
 * @param {Error} error - will be null if no error occured
 * @returns {void}
 */
module.exports = function terminate(pid) {
  let i = 1;
  let signal; let options; let
    callback;

  if (!pid) {
    throw new Error('No pid supplied to Terminate!');
  }

  // extract optional arguments.  Any can be omitted, but the
  // ones present have to be in the
  if (typeof arguments[i] === 'string') { // eslint-disable-line prefer-rest-params
    signal = arguments[i++]; // eslint-disable-line prefer-rest-params
  }
  if (typeof arguments[i] === 'object' && arguments[i]) { // eslint-disable-line prefer-rest-params
    options = arguments[i++]; // eslint-disable-line prefer-rest-params
  }
  if (typeof arguments[i] === 'function') { // eslint-disable-line prefer-rest-params
    callback = arguments[i++]; // eslint-disable-line prefer-rest-params
  }

  psTree(pid, (err, children) => {
    handlePsTreeCallback(
      err,
      children,
      pid,
      signal,
      options,
      callback,
    );
  });
};

