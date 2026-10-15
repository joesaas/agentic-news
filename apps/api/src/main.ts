import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { config } from "./config";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: config.webOrigin, credentials: false });
  app.setGlobalPrefix("api");
  await app.listen(config.port);
  // eslint-disable-next-line no-console
  console.log(`[api] listening on :${config.port}`);
}

void bootstrap();
