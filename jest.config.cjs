module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/docs', '<rootDir>/tests'],
  testPathIgnorePatterns: ['<rootDir>/tests/playwright'],
  testMatch: ['**/?(*.)+(spec|test).[jt]s?(x)'],
  snapshotSerializers: [],
  verbose: true,
};
