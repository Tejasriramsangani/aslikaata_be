import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { EmployeesService } from './employees.service.js';
import {
  CreateEmployeeProfileDto,
  UploadEmployeeDocumentDto,
  ReviewDocumentDto,
  ReviewEmployeeStatusDto,
} from './dto/employee.dto.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles, UserRole } from '../../common/decorators/roles.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { CurrentUserPayload } from '../../common/decorators/current-user.decorator.js';

@Controller('api/v1')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  // --- Employee Self Endpoints ---

  @Roles(UserRole.EMPLOYEE)
  @Post('employee/profile')
  async createOrUpdateProfile(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreateEmployeeProfileDto,
  ) {
    return this.employeesService.createOrUpdateProfile(user.userId, dto);
  }

  @Roles(UserRole.EMPLOYEE)
  @Get('employee/profile')
  async getProfile(@CurrentUser() user: CurrentUserPayload) {
    return this.employeesService.getProfile(user.userId);
  }

  @Roles(UserRole.EMPLOYEE)
  @Post('employee/documents')
  async uploadDocument(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: UploadEmployeeDocumentDto,
  ) {
    return this.employeesService.uploadDocument(user.userId, dto);
  }

  @Roles(UserRole.EMPLOYEE)
  @Get('employee/documents')
  async getMyDocuments(@CurrentUser() user: CurrentUserPayload) {
    return this.employeesService.getMyDocuments(user.userId);
  }

  // --- Admin KYC & Management Endpoints ---

  @Roles(UserRole.ADMIN)
  @Get('admin/employees')
  async listAllEmployees(@Query('status') status?: string) {
    return this.employeesService.listAllEmployees(status);
  }

  @Roles(UserRole.ADMIN)
  @Get('admin/employees/pending-kyc')
  async listPendingKyc() {
    return this.employeesService.listPendingKyc();
  }

  @Roles(UserRole.ADMIN)
  @Get('admin/employees/:id/documents')
  async getEmployeeDocuments(
    @Param('id') profileId: string,
    @CurrentUser() admin: CurrentUserPayload,
    @Req() req: Request,
  ) {
    const ip = req.ip || req.socket.remoteAddress;
    return this.employeesService.getEmployeeDocumentsForAdmin(profileId, admin.userId, ip);
  }

  @Roles(UserRole.ADMIN)
  @Post('admin/employees/documents/:docId/review')
  async reviewDocument(
    @Param('docId') docId: string,
    @CurrentUser() admin: CurrentUserPayload,
    @Body() dto: ReviewDocumentDto,
  ) {
    return this.employeesService.reviewDocument(docId, admin.userId, dto);
  }

  @Roles(UserRole.ADMIN)
  @Post('admin/employees/:id/approve')
  async approveEmployee(
    @Param('id') profileId: string,
    @CurrentUser() admin: CurrentUserPayload,
  ) {
    return this.employeesService.approveEmployee(profileId, admin.userId);
  }

  @Roles(UserRole.ADMIN)
  @Post('admin/employees/:id/status')
  async setStatus(
    @Param('id') profileId: string,
    @CurrentUser() admin: CurrentUserPayload,
    @Body() dto: ReviewEmployeeStatusDto,
  ) {
    return this.employeesService.setEmployeeStatus(profileId, admin.userId, dto);
  }
}
