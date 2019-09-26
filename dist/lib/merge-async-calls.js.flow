// @flow

const { hash64 } = require('@bunchtogether/hash-object');

module.exports = (func:Function) => {
  const promiseMap = {};
  return (...args:Array<any>) => {
    const cacheKey = hash64(args);
    if (promiseMap[cacheKey]) {
      return promiseMap[cacheKey];
    }
    const promise = func(...args);
    promiseMap[cacheKey] = promise;
    promise.then(() => {
      delete promiseMap[cacheKey];
    }).catch(() => {
      delete promiseMap[cacheKey];
    });
    return promise;
  };
};
