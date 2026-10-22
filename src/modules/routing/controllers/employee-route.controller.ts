import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../../common/guards/roles.guard.js';
import { Roles, UserRole } from '../../../common/decorators/roles.decorator.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import { RouteRunsService } from '../services/route-runs.service.js';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EmployeeProfile, EmployeeProfileDocument } from '../../employees/schemas/employee-profile.schema.js';

@Controller('api/v1/employee/route')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.EMPLOYEE)
export class EmployeeRouteController {
  constructor(
    private readonly routeRunsService: RouteRunsService,
    @InjectModel(EmployeeProfile.name)
    private readonly employeeProfileModel: Model<EmployeeProfileDocument>,
  ) {}

  @Get('today')
  async getTodayRoute(@CurrentUser() user: any, @Query('date') dateQuery?: string) {
    const profile = await this.employeeProfileModel.findOne({ userId: user._id });
    if (!profile) {
      return { hasRouteToday: false, message: 'Employee profile not found' };
    }

    return this.routeRunsService.getTodayRouteForEmployee(profile._id.toString(), dateQuery);
  }
}
