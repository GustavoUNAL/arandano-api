import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { UpsertRecipeDto } from './dto/upsert-recipe.dto';
import { ProductsService } from './products.service';

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Post()
  create(@Body() dto: CreateProductDto) {
    return this.productsService.create(dto);
  }

  @Get()
  findAll(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('search') search?: string,
    @Query('categoryId') categoryId?: string,
    @Query('active') activeRaw?: string,
    @Query('type') type?: string,
    @Query('sort') sort?: 'name' | 'price_asc' | 'price_desc',
  ) {
    let active: boolean | undefined;
    if (activeRaw === 'true') active = true;
    else if (activeRaw === 'false') active = false;

    return this.productsService.findAll({
      page,
      limit,
      search,
      categoryId,
      active,
      type,
      sort: sort ?? 'name',
    });
  }

  @Put(':id/recipe')
  upsertRecipe(@Param('id') id: string, @Body() dto: UpsertRecipeDto) {
    return this.productsService.upsertRecipe(id, dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.productsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.productsService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.productsService.remove(id);
  }
}
