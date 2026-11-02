import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles, UserRole } from '../../common/decorators/roles.decorator.js';
import { StaffAccess, StaffRole, ALL_STAFF } from '../../common/decorators/staff-access.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { OperationsService } from './operations.service.js';

@Controller('api/v1/admin/operations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class OperationsController {
  constructor(private readonly operationsService: OperationsService) {}

  // --- Fuel Logs ---
  @StaffAccess({ read: [StaffRole.DISPATCHER, StaffRole.ACCOUNTANT] })
  @Get('fuel-logs')
  async getFuelLogs() {
    return this.operationsService.getFuelLogs();
  }

  @StaffAccess({ write: [StaffRole.DISPATCHER] })
  @Post('fuel-logs')
  async createFuelLog(@Body() body: any) {
    return this.operationsService.createFuelLog(body);
  }

  // --- Maintenance Logs ---
  @StaffAccess({ read: [StaffRole.DISPATCHER, StaffRole.ACCOUNTANT] })
  @Get('maintenance-logs')
  async getMaintenanceLogs() {
    return this.operationsService.getMaintenanceLogs();
  }

  @StaffAccess({ write: [StaffRole.DISPATCHER] })
  @Post('maintenance-logs')
  async createMaintenanceLog(@Body() body: any) {
    return this.operationsService.createMaintenanceLog(body);
  }

  // --- Incidental Logs ---
  @StaffAccess({ read: [StaffRole.DISPATCHER, StaffRole.ACCOUNTANT] })
  @Get('incidental-logs')
  async getIncidentalLogs() {
    return this.operationsService.getIncidentalLogs();
  }

  @StaffAccess({ write: [StaffRole.DISPATCHER] })
  @Post('incidental-logs')
  async createIncidentalLog(@Body() body: any) {
    return this.operationsService.createIncidentalLog(body);
  }

  // --- Inward Vouchers ---
  @StaffAccess({ read: [StaffRole.YARD_MANAGER, StaffRole.ACCOUNTANT] })
  @Get('inward-vouchers')
  async getInwardVouchers(@Query('channel') channel?: string) {
    return this.operationsService.getInwardVouchers(channel);
  }

  @StaffAccess({ write: [StaffRole.YARD_MANAGER] })
  @Post('inward-vouchers')
  async createInwardVoucher(@Body() body: any) {
    return this.operationsService.createInwardVoucher(body);
  }

  // --- Yard Reconciliations ---
  @StaffAccess({ read: [StaffRole.YARD_MANAGER, StaffRole.ACCOUNTANT] })
  @Get('yard-reconciliations')
  async getYardReconciliations() {
    return this.operationsService.getYardReconciliations();
  }

  @StaffAccess({ write: [StaffRole.YARD_MANAGER] })
  @Patch('yard-reconciliations/:id/sign-off')
  async signOffReconciliation(
    @Param('id') id: string,
    @Body('notes') notes?: string,
  ) {
    return this.operationsService.signOffReconciliation(id, notes);
  }

  // --- Cash Floats ---
  @StaffAccess({ read: ALL_STAFF })
  @Get('cash-floats')
  async getCashFloats(@Query('date') date?: string) {
    return this.operationsService.getCashFloats(date);
  }

  @StaffAccess({ write: [StaffRole.ACCOUNTANT] })
  @Post('cash-floats/issue')
  async issueCashFloat(@Body() body: any, @CurrentUser() user: any) {
    return this.operationsService.issueCashFloat({
      ...body,
      issuedByAdmin: user?.name || user?.email || 'Operations Admin',
    });
  }

  @StaffAccess({ write: [StaffRole.ACCOUNTANT] })
  @Patch('cash-floats/:id/settle')
  async settleCashFloat(
    @Param('id') id: string,
    @Body() body: { actualPhysicalCashReturnedRupees: number; auditNotes?: string },
  ) {
    return this.operationsService.settleCashFloat(id, body);
  }

  // --- Yard Stock ---
  @StaffAccess({ read: [StaffRole.YARD_MANAGER, StaffRole.ACCOUNTANT] })
  @Get('yard-stock')
  async getYardStock() {
    return this.operationsService.getYardStock();
  }

  @StaffAccess({ write: [StaffRole.YARD_MANAGER] })
  @Post('yard-stock')
  async createOrUpdateYardStock(@Body() body: any) {
    return this.operationsService.createOrUpdateYardStock(body);
  }

  // --- Outward Dispatches ---
  @StaffAccess({ read: [StaffRole.YARD_MANAGER, StaffRole.ACCOUNTANT] })
  @Get('outward-dispatches')
  async getOutwardDispatches() {
    return this.operationsService.getOutwardDispatches();
  }

  @StaffAccess({ write: [StaffRole.YARD_MANAGER] })
  @Post('outward-dispatches')
  async createOutwardDispatch(@Body() body: any, @CurrentUser() user: any) {
    return this.operationsService.createOutwardDispatch({
      ...body,
      authorizedBy: user?.name || user?.email || 'Yard In-charge',
    });
  }

  // --- Workforce Employees & KYC ---
  @StaffAccess({ read: [StaffRole.YARD_MANAGER, StaffRole.DISPATCHER, StaffRole.ACCOUNTANT] })
  @Get('employees')
  async getEmployees() {
    return this.operationsService.getEmployees();
  }

  @Patch('employees/:id/kyc')
  async updateKycStatus(
    @Param('id') id: string,
    @Body('status') status: string,
  ) {
    return this.operationsService.updateKycStatus(id, status);
  }

  // --- Unit Economics & P&L ---
  @StaffAccess({ read: [StaffRole.ACCOUNTANT] })
  @Get('unit-economics-pnl')
  async getUnitEconomicsAndPnL(@Query('timeWindow') timeWindow?: string) {
    return this.operationsService.getUnitEconomicsAndPnL(timeWindow);
  }

  // --- Fraud Sentinel Alerts ---
  @StaffAccess({ read: [StaffRole.ACCOUNTANT] })
  @Get('fraud-alerts')
  async getFraudAlerts() {
    return this.operationsService.getFraudAlerts();
  }

  @StaffAccess({ write: [StaffRole.ACCOUNTANT] })
  @Patch('fraud-alerts/:id')
  async updateFraudAlertStatus(
    @Param('id') id: string,
    @Body('status') status: string,
    @Body('notes') notes?: string,
  ) {
    return this.operationsService.updateFraudAlertStatus(id, status, notes);
  }
}
