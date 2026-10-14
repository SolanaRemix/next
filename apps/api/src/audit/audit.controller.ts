import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../auth/auth.decorators.js';
import { AuditQueryDto } from './audit-query.dto.js';
import { AuditService } from './audit.service.js';

@Controller('admin/audit-logs')
@Roles('SuperAdmin')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(@Query() query: AuditQueryDto) {
    return this.audit.list(query);
  }
}
