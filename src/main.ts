import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { assertPortAvailable, isAddressInUse, portInUseMessage } from './common/startup/port.js';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const port = Number(process.env.PORT ?? 4000);
  try {
    await assertPortAvailable(port);
  } catch (error) {
    if (!isAddressInUse(error)) throw error;
    logger.error(portInUseMessage(port));
    process.exitCode = 1;
    return;
  }
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: true,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  try {
    await app.listen(port);
  } catch (error) {
    // Another process may claim the port between the probe and listen().
    await app.close();
    if (!isAddressInUse(error)) throw error;
    logger.error(portInUseMessage(port));
    process.exitCode = 1;
    return;
  }
  logger.log(`🚀 ASLI KAATA Backend is running on: http://localhost:${port}`);
}

await bootstrap();
