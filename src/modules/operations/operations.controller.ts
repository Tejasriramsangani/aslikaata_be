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
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { OperationsService } from './operations.service.js';

@Controller('api/v1/admin/operations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class OperationsController {
  constructor(private readonly operationsService: OperationsService) {}

  // --- Fuel Logs ---
  @Get('fuel-logs')
  async getFuelLogs() {
    return this.operationsService.getFuelLogs();
  }

  @Post('fuel-logs')
  async createFuelLog(@Body() body: any) {
    return this.operationsService.createFuelLog(body);
  }

  // --- Maintenance Logs ---
  @Get('maintenance-logs')
  async getMaintenanceLogs() {
    return this.operationsService.getMaintenanceLogs();
  }

  @Post('maintenance-logs')
  async createMaintenanceLog(@Body() body: any) {
    return this.operationsService.createMaintenanceLog(body);
  }

  // --- Incidental Logs ---
  @Get('incidental-logs')
  async getIncidentalLogs() {
    return this.operationsService.getIncidentalLogs();
  }

  @Post('incidental-logs')
  async createIncidentalLog(@Body() body: any) {
    return this.operationsService.createIncidentalLog(body);
  }

  // --- Inward Vouchers ---
  @Get('inward-vouchers')
  async getInwardVouchers(@Query('channel') channel?: string) {
    return this.operationsService.getInwardVouchers(channel);
  }

  @Post('inward-vouchers')
  async createInwardVoucher(@Body() body: any) {
    return this.operationsService.createInwardVoucher(body);
  }

  // --- Yard Reconciliations ---
  @Get('yard-reconciliations')
  async getYardReconciliations() {
    return this.operationsService.getYardReconciliations();
  }

  @Patch('yard-reconciliations/:id/sign-off')
  async signOffReconciliation(
    @Param('id') id: string,
    @Body('notes') notes?: string,
  ) {
    return this.operationsService.signOffReconciliation(id, notes);
  }

  // --- Cash Floats ---
  @Get('cash-floats')
  async getCashFloats(@Query('date') date?: string) {
    return this.operationsService.getCashFloats(date);
  }

  @Post('cash-floats/issue')
  async issueCashFloat(@Body() body: any, @CurrentUser() user: any) {
    return this.operationsService.issueCashFloat({
      ...body,
      issuedByAdmin: user?.name || user?.email || 'Operations Admin',
    });
  }

  @Patch('cash-floats/:id/settle')
  async settleCashFloat(
    @Param('id') id: string,
    @Body() body: { actualPhysicalCashReturnedRupees: number; auditNotes?: string },
  ) {
    return this.operationsService.settleCashFloat(id, body);
  }

  // --- Yard Stock ---
  @Get('yard-stock')
  async getYardStock() {
    return this.operationsService.getYardStock();
  }

  @Post('yard-stock')
  async createOrUpdateYardStock(@Body() body: any) {
    return this.operationsService.createOrUpdateYardStock(body);
  }

  // --- Outward Dispatches ---
  @Get('outward-dispatches')
  async getOutwardDispatches() {
    return this.operationsService.getOutwardDispatches();
  }

  @Post('outward-dispatches')
  async createOutwardDispatch(@Body() body: any, @CurrentUser() user: any) {
    return this.operationsService.createOutwardDispatch({
      ...body,
      authorizedBy: user?.name || user?.email || 'Yard In-charge',
    });
  }

  // --- Workforce Employees & KYC ---
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
  @Get('unit-economics-pnl')
  async getUnitEconomicsAndPnL(@Query('timeWindow') timeWindow?: string) {
    return this.operationsService.getUnitEconomicsAndPnL(timeWindow);
  }

  // --- Fraud Sentinel Alerts ---
  @Get('fraud-alerts')
  async getFraudAlerts() {
    return this.operationsService.getFraudAlerts();
  }

  @Patch('fraud-alerts/:id')
  async updateFraudAlertStatus(
    @Param('id') id: string,
    @Body('status') status: string,
    @Body('notes') notes?: string,
  ) {
    return this.operationsService.updateFraudAlertStatus(id, status, notes);
  }
}
