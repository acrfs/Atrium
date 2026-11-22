import { Module } from "@nestjs/common";
import { GoogleSsoController } from "./google-sso.controller";
import { GoogleSsoService } from "./google-sso.service";

@Module({
  controllers: [GoogleSsoController],
  providers: [GoogleSsoService],
})
export class GoogleSsoModule {}
