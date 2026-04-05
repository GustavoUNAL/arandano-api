import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { SaleSource } from '@prisma/client';
import { CreateSaleDto } from './dto/create-sale.dto';
import { ReplaceSaleLinesDto } from './dto/replace-sale-lines.dto';
import { UpdateSaleDto } from './dto/update-sale.dto';
import { SalesService } from './sales.service';

@Controller('sales')
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  @Post()
  create(@Body() dto: CreateSaleDto) {
    return this.salesService.create(dto);
  }

  @Get()
  findAll(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('search') search?: string,
    @Query('source') sourceRaw?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    let source: SaleSource | undefined;
    if (
      sourceRaw &&
      (Object.values(SaleSource) as string[]).includes(sourceRaw)
    ) {
      source = sourceRaw as SaleSource;
    }
    return this.salesService.findAll({
      page,
      limit,
      search,
      source,
      dateFrom,
      dateTo,
    });
  }

  @Put(':id/lines')
  replaceLines(@Param('id') id: string, @Body() dto: ReplaceSaleLinesDto) {
    return this.salesService.replaceLines(id, dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateSaleDto) {
    return this.salesService.update(id, dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.salesService.findOne(id);
  }
}
