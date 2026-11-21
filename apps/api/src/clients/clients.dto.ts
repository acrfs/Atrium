import { IsIn, IsInt, IsOptional, IsString, Min } from "class-validator";
import { PaginationQueryDto } from "../common";

export const MEMBER_KINDS = ["staff", "client"] as const;
export type MemberKind = (typeof MEMBER_KINDS)[number];

export class ListMembersQueryDto extends PaginationQueryDto {
  /** staff = owners, admins and developers; client = portal clients (role "member"). */
  @IsOptional()
  @IsIn(MEMBER_KINDS)
  role?: MemberKind;
}

export class ChangeRoleDto {
  @IsString()
  @IsIn(["owner", "admin", "developer", "member"])
  role!: string;
}

/**
 * Better Auth only knows owner, admin and member, so a Developer is invited as
 * an admin and the pending invitation is then switched to "developer". Only an
 * admin invitation can be switched, and only to developer or back.
 */
export class SetInvitationRoleDto {
  @IsString()
  @IsIn(["admin", "developer"])
  role!: string;
}

export class SetRateDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  hourlyRateCents?: number | null;
}
