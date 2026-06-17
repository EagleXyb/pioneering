import { Controller, Get } from '@nestjs/common';
import { SystemService } from './system.service';
import { Public } from '../common/decorators/public.decorator';

@Controller('system')
export class SystemController {
  constructor(private readonly systemService: SystemService) {}

  @Public()
  @Get('models')
  getModels() {
    return this.systemService.getModels();
  }

  @Public()
  @Get('config')
  getConfig() {
    return this.systemService.getConfig();
  }
}

@Controller('health')
export class HealthController {
  constructor(private readonly systemService: SystemService) {}

  @Public()
  @Get()
  getHealth() {
    return this.systemService.getHealth();
  }
}