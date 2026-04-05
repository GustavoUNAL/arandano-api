import {
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Query,
} from '@nestjs/common';
import { ExplorerService } from './explorer.service';

@Controller('explorer')
export class ExplorerController {
  constructor(private readonly explorer: ExplorerService) {}

  @Get('tables')
  listTables() {
    return this.explorer.listTables();
  }

  @Get('tables/:slug')
  getTable(
    @Param('slug') slug: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
  ) {
    return this.explorer.getTableRows(slug, limit, offset);
  }
}
