import { IsEmail, IsString, MaxLength, MinLength } from "class-validator";

export class StudioSyncDto {
  @IsEmail()
  loginEmail!: string;

  @IsEmail()
  smtpUser!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}
