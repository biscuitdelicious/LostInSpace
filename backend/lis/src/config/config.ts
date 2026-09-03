import { PostgreSQLProps } from 'src/interfaces/config.interfaces.js';

export const config = (): PostgreSQLProps => ({
  serverPort: parseInt(process.env.SERVER_PORT!),
  dbPort: parseInt(process.env.DB_PORT!),
  dbUser: process.env.DB_USER!,
  dbPassword: process.env.DB_PASSWORD!,
});
