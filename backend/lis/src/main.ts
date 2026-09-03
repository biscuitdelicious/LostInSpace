import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // const configService = app.get(ConfigService);

  // const port = configService.get<number>('serverPort');

  // Logger.log(`Port number: ${port}`);

  await app.listen(3000);
}
bootstrap();
