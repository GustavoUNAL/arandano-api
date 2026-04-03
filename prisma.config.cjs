/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

require('dotenv/config');
const path = require('node:path');
const { defineConfig } = require('prisma/config');

const root = __dirname;

module.exports = defineConfig({
  schema: path.join(root, 'prisma', 'schema.prisma'),
  migrations: {
    path: path.join(root, 'prisma', 'migrations'),
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
