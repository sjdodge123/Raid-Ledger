import './sentry/instrument'; // MUST be first — installs Sentry before Nest loads
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { loadHubConfig } from './config/hub-config';

async function bootstrap(): Promise<void> {
  // Validate before Nest boots: a bad env fails fast with the key names.
  const config = loadHubConfig(process.env);
  const app = configureApp(await NestFactory.create(AppModule));
  await app.listen(config.port, config.host);
}

void bootstrap();
