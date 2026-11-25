// Integration specs run on a UTC clock, like api's (ROK-1595). They need
// DATABASE_URL: each file creates its own throwaway database (ROK-1670 L10).
process.env.TZ = 'UTC';

const base = require('./jest.config.js');

/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  ...base,
  testRegex: '.*\\.integration\\.spec\\.ts$',
  testPathIgnorePatterns: [],
  testTimeout: 60_000,
  forceExit: true,
};
