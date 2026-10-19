import { Controller, Get } from '@nestjs/common';
import { Public } from './common/guards/jwt-auth.guard.js';

@Controller()
export class AppController {
  @Public()
  @Get('health')
  getHealth() {
    return {
      status: 'ok',
      service: 'ASLI KAATA Backend Engine',
      uptimeSeconds: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }

  @Public()
  @Get()
  getRoot() {
    return {
      name: 'ASLI KAATA API',
      version: '1.0.0',
      status: 'running',
    };
  }
}
