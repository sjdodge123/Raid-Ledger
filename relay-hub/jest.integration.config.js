// Integration specs run on a UTC clock, like api's (ROK-1595). No DB yet:
// RH-2b (ROK-1670) adds Postgres and a globalSetup.
process.env.TZ = 'UTC';

const base = require('./jest.config.js');

/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  ...base,
  testRegex: '.*\\.integration\\.spec\\.ts$',
  testPathIgnorePatterns: [],
  testTimeout: 30_000,
  forceExit: true,
};
