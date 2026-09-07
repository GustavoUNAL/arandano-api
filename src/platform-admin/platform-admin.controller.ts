import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.types';
import { PlatformAdminGuard } from './platform-admin.guard';
import { PlatformAdminService } from './platform-admin.service';
import { SetCompanyPlanDto } from './dto/set-company-plan.dto';
import { SetCompanyModuleDto } from './dto/set-company-module.dto';
import { UpdatePlatformUserDto } from './dto/update-platform-user.dto';
import { UpdateAccessRequestDto } from './dto/update-access-request.dto';

@Controller('platform')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class PlatformAdminController {
  constructor(private readonly platform: PlatformAdminService) {}

  @Get('overview')
  overview() {
    return this.platform.overview();
  }

  @Get('companies')
  companies() {
    return this.platform.listCompanies();
  }

  @Get('companies/:id')
  async company(@Param('id') id: string) {
    const detail = await this.platform.companyDetail(id);
    if (!detail) throw new NotFoundException('Empresa no encontrada');
    return detail;
  }

  @Get('modules')
  modules() {
    return this.platform.listModules();
  }

  @Get('users')
  users() {
    return this.platform.listUsers();
  }

  @Get('users/:id')
  async user(@Param('id') id: string) {
    const detail = await this.platform.userDetail(id);
    if (!detail) throw new NotFoundException('Usuario no encontrado');
    return detail;
  }

  @Patch('users/:id')
  updateUser(@Param('id') id: string, @Body() body: UpdatePlatformUserDto) {
    return this.platform.updateUser(id, body);
  }

  @Delete('users/:id')
  deleteUser(@Param('id') id: string, @CurrentUser() actor: JwtPayload) {
    return this.platform.deleteUser(id, actor.sub);
  }

  @Patch('companies/:id/plan')
  setPlan(@Param('id') id: string, @Body() body: SetCompanyPlanDto) {
    return this.platform.setCompanyPlan(id, body.plan);
  }

  @Patch('companies/:id/modules')
  setCompanyModule(
    @Param('id') id: string,
    @Body() body: SetCompanyModuleDto,
  ) {
    return this.platform.setCompanyModule(id, body.slug, body.enabled);
  }

  @Get('access-requests')
  accessRequests(@Query('status') status?: string) {
    return this.platform.listAccessRequests(status);
  }

  @Patch('access-requests/:id')
  updateAccessRequest(
    @Param('id') id: string,
    @Body() body: UpdateAccessRequestDto,
  ) {
    return this.platform.updateAccessRequest(id, body.status);
  }

  @Delete('access-requests/:id')
  deleteAccessRequest(@Param('id') id: string) {
    return this.platform.deleteAccessRequest(id);
  }
}
