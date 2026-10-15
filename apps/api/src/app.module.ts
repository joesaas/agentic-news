import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { JwtGuard } from "./auth";
import { AuthController } from "./auth.controller";
import { ProfileController } from "./profile.controller";
import { TopicsController } from "./topics.controller";
import { FeedController } from "./feed.controller";
import { ApiKeysController, IngestController } from "./ingest.controller";
import { RankService } from "./rank.service";
import { VectorsService } from "./vectors.service";

@Module({
  controllers: [
    AuthController,
    ProfileController,
    TopicsController,
    FeedController,
    ApiKeysController,
    IngestController,
  ],
  providers: [
    RankService,
    VectorsService,
    { provide: APP_GUARD, useClass: JwtGuard },
  ],
})
export class AppModule {}
