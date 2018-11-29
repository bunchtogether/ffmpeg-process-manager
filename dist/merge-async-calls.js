//      

const objectHasherFactory = require('node-object-hash');

const objectHasher = objectHasherFactory({ sort: false, coerce: false });

module.exports = (func         ) => {
  const promiseMap = {};
  return (...args           ) => {
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
