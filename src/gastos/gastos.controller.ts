import { Body, Controller, Delete, Get, Put, Query } from '@nestjs/common';
import { GastoKind, GastoType } from '@prisma/client';
import { GastosService } from './gastos.service';
import { UpsertGastoDto } from './dto/upsert-gasto.dto';

@Controller('gastos')
export class GastosController {
  constructor(private readonly service: GastosService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Put()
  upsert(@Body() dto: UpsertGastoDto) {
    return this.service.upsert(dto);
  }

  /** Borra por (kind,type) usando query params. */
  @Delete()
  remove(@Query('kind') kind: GastoKind, @Query('type') type: GastoType) {
    return this.service.remove(kind, type);
  }
}

