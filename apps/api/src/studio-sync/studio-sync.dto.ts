import { IsEmail, IsString, MaxLength, MinLength } from "class-validator";

export class StudioSyncDto {
  @IsEmail()
  loginEmail!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}

export class StudioVerifyDto {
  @IsEmail()
  loginEmail!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}
