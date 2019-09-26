//      

const { hash64 } = require('@bunchtogether/hash-object');

module.exports = (func         ) => {
  const promiseMap = {};
  return (...args           ) => {
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
