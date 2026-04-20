import { Controller, Get } from '@nestjs/common';
import { NavigationService } from './navigation.service';

@Controller('navigation')
export class NavigationController {
  constructor(private readonly nav: NavigationService) {}

  /** Mapa de menú → endpoints para armar el front. */
  @Get()
  menu() {
    return this.nav.getMenu();
  }
}
