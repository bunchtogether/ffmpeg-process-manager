// @flow

const objectHasherFactory = require('node-object-hash');

const objectHasher = objectHasherFactory({ sort: false, coerce: false });

module.exports = (func:Function) => {
  const promiseMap = {};
  return (...args:Array<any>) => {
    const cacheKey = objectHasher.hash(args);
    if (promiseMap[cacheKey]) {
      return promiseMap[cacheKey];
    }
    const promise = func(...args);
    promiseMap[cacheKey] = promise;
    promise.then(() => {
      delete promiseMap[cacheKey];
    }).catch((error) => {
      delete promiseMap[cacheKey];
      throw error;
    });
    return promise;
  };
};
