/**
 * DTO for lineup phase duration defaults (ROK-946).
 */
import { IsOptional, IsInt, Min, Max } from 'class-validator';

export class LineupDefaultsDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(720)
  buildingDurationHours?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(720)
  votingDurationHours?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(720)
  decidedDurationHours?: number;
}
